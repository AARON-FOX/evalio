BEGIN;

CREATE TABLE public.active_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES public.tests(id) ON DELETE RESTRICT,
  series_id UUID NOT NULL,
  respondent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  question_order UUID[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','submitted')),
  submission_id UUID UNIQUE REFERENCES public.submissions(id),
  finished_at TIMESTAMPTZ,
  finish_reason TEXT CHECK (finish_reason IN ('manual','timeout')),
  CONSTRAINT evalio_attempt_answers_object CHECK (jsonb_typeof(answers) = 'object'),
  CONSTRAINT evalio_attempt_finish_consistency CHECK (
    (status = 'active' AND submission_id IS NULL AND finished_at IS NULL)
    OR
    (status = 'submitted' AND submission_id IS NOT NULL AND finished_at IS NOT NULL)
  )
);

-- A student can have only one unfinished attempt across versions of a logical test.
CREATE UNIQUE INDEX evalio_one_active_attempt_per_series
  ON public.active_attempts(respondent_id, series_id)
  WHERE status = 'active';
CREATE INDEX evalio_active_attempts_student_idx
  ON public.active_attempts(respondent_id, started_at DESC);
CREATE INDEX evalio_active_attempts_expiry_idx
  ON public.active_attempts(expires_at)
  WHERE status = 'active';

-- Never expose the private answer JSON through the browser's Supabase client.
ALTER TABLE public.active_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.active_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.active_attempts TO service_role;

CREATE FUNCTION public.evalio_start_active_attempt(
  p_test_id UUID, p_respondent_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_test public.tests%ROWTYPE;
  v_existing public.active_attempts%ROWTYPE;
  v_attempt_id UUID;
  v_started TIMESTAMPTZ := statement_timestamp();
  v_expiry TIMESTAMPTZ;
  v_order UUID[];
  v_completed INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_respondent_id AND role = 'respondent'
  ) THEN RAISE EXCEPTION 'respondent_required'; END IF;

  SELECT * INTO v_test FROM public.tests
  WHERE id = p_test_id AND status = 'published' AND is_current
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'test_not_available'; END IF;

  -- Same advisory key/ordering as 010's legacy submit RPC; serialize starts.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_test.series_id::TEXT || ':' || p_respondent_id::TEXT, 0
    )
  );

  SELECT * INTO v_existing FROM public.active_attempts
  WHERE series_id = v_test.series_id
    AND respondent_id = p_respondent_id AND status = 'active'
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('attemptId',v_existing.id,'resumed',TRUE);
  END IF;

  IF v_test.available_until IS NOT NULL
     AND v_started >= v_test.available_until THEN
    RAISE EXCEPTION 'test_deadline_passed';
  END IF;

  SELECT count(*)::INTEGER INTO v_completed
  FROM public.submissions s
  JOIN public.tests t ON t.id = s.test_id
  WHERE t.series_id = v_test.series_id AND s.respondent_id = p_respondent_id;

  IF v_test.max_attempts IS NOT NULL AND v_completed >= v_test.max_attempts THEN
    RAISE EXCEPTION 'attempt_limit_reached';
  END IF;

  SELECT array_agg(id ORDER BY ord) INTO v_order
  FROM (
    SELECT q.id,
      row_number() OVER (
        ORDER BY CASE WHEN v_test.shuffle_questions THEN random() ELSE NULL END,
                 CASE WHEN NOT v_test.shuffle_questions THEN q.position ELSE NULL END,
                 q.id
      ) AS ord
    FROM public.questions q WHERE q.test_id = v_test.id
  ) ordered;

  IF coalesce(array_length(v_order, 1), 0) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'test_has_invalid_questions';
  END IF;

  v_expiry := CASE
    WHEN v_test.duration_minutes IS NOT NULL AND v_test.available_until IS NOT NULL
      THEN LEAST(v_started + make_interval(mins => v_test.duration_minutes), v_test.available_until)
    WHEN v_test.duration_minutes IS NOT NULL
      THEN v_started + make_interval(mins => v_test.duration_minutes)
    ELSE v_test.available_until
  END;

  INSERT INTO public.active_attempts (
    test_id, series_id, respondent_id, started_at, expires_at, question_order
  ) VALUES (
    v_test.id, v_test.series_id, p_respondent_id, v_started, v_expiry, v_order
  ) RETURNING id INTO v_attempt_id;

  RETURN jsonb_build_object('attemptId', v_attempt_id, 'resumed', FALSE);
END;
$$;

CREATE FUNCTION public.evalio_save_active_answer(
  p_attempt_id UUID, p_respondent_id UUID,
  p_question_id UUID, p_option_ids JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_attempt public.active_attempts%ROWTYPE;
  v_type TEXT;
  v_count INTEGER;
  v_distinct INTEGER;
  v_valid INTEGER;
  v_saved TIMESTAMPTZ := statement_timestamp();
BEGIN
  SELECT * INTO v_attempt FROM public.active_attempts
  WHERE id = p_attempt_id AND respondent_id = p_respondent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF v_attempt.status <> 'active' THEN RAISE EXCEPTION 'attempt_finished'; END IF;
  IF v_attempt.expires_at IS NOT NULL AND v_saved >= v_attempt.expires_at THEN
    RAISE EXCEPTION 'attempt_time_expired';
  END IF;

  SELECT q.question_type INTO v_type FROM public.questions q
  WHERE q.id = p_question_id AND q.test_id = v_attempt.test_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'question_not_in_test'; END IF;

  IF jsonb_typeof(p_option_ids) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_option_selection';
  END IF;
  v_count := jsonb_array_length(p_option_ids);
  IF v_count > 12 OR (v_type = 'single_choice' AND v_count > 1) THEN
    RAISE EXCEPTION 'invalid_option_selection';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_option_ids) x(value)
    WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'string'
      OR (x.value #>> '{}') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) THEN RAISE EXCEPTION 'invalid_option_id'; END IF;

  SELECT count(DISTINCT picked.value)::INTEGER, count(o.id)::INTEGER
    INTO v_distinct, v_valid
  FROM jsonb_array_elements_text(p_option_ids) picked(value)
  LEFT JOIN public.options o ON o.id = picked.value::UUID
    AND o.question_id = p_question_id;
  IF v_distinct <> v_count OR v_valid <> v_count THEN
    RAISE EXCEPTION 'invalid_option_selection';
  END IF;

  UPDATE public.active_attempts
  SET answers = answers || jsonb_build_object(p_question_id::TEXT, p_option_ids),
      updated_at = v_saved
  WHERE id = p_attempt_id;

  RETURN jsonb_build_object('questionId', p_question_id,
    'optionIds',p_option_ids,'savedAt',v_saved);
END;
$$;

CREATE FUNCTION public.evalio_finish_active_attempt(
  p_attempt_id UUID, p_respondent_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_series_id UUID;
  v_attempt public.active_attempts%ROWTYPE;
  v_test public.tests%ROWTYPE;
  v_q RECORD;
  v_selected JSONB;
  v_total INTEGER;
  v_correct INTEGER;
  v_correct_selected INTEGER;
  v_score INTEGER := 0;
  v_max_score INTEGER := 0;
  v_submission_id UUID;
  v_submitted_at TIMESTAMPTZ;
  v_reason TEXT;
BEGIN
  SELECT series_id INTO v_series_id FROM public.active_attempts
  WHERE id = p_attempt_id AND respondent_id = p_respondent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;

  -- Take the same advisory lock as start/legacy submit before row lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_series_id::TEXT || ':' || p_respondent_id::TEXT, 0)
  );
  SELECT * INTO v_attempt FROM public.active_attempts
  WHERE id = p_attempt_id AND respondent_id = p_respondent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;

  SELECT * INTO v_test FROM public.tests WHERE id = v_attempt.test_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'test_not_available'; END IF;

  IF v_attempt.status = 'submitted' THEN
    SELECT id, submitted_at INTO v_submission_id, v_submitted_at
      FROM public.submissions WHERE id = v_attempt.submission_id;
    RETURN (
      SELECT jsonb_build_object(
        'id', s.id, 'testId', s.test_id, 'kind', v_test.kind,
        'resultVisible', (v_test.kind = 'test' AND v_test.show_result_immediately),
        'score', CASE WHEN v_test.kind = 'test' AND v_test.show_result_immediately THEN s.score ELSE NULL END,
        'maxScore', CASE WHEN v_test.kind = 'test' AND v_test.show_result_immediately THEN s.max_score ELSE NULL END,
        'submittedAt', s.submitted_at, 'reason', v_attempt.finish_reason
      ) FROM public.submissions s WHERE s.id = v_attempt.submission_id
    );
  END IF;

  FOR v_q IN
    SELECT id, points FROM public.questions WHERE test_id = v_attempt.test_id
  LOOP
    v_max_score := v_max_score + v_q.points;
    v_selected := coalesce(v_attempt.answers -> v_q.id::TEXT, '[]'::jsonb);
    v_total := jsonb_array_length(v_selected);
    SELECT count(*)::INTEGER INTO v_correct
    FROM public.correct_options co
    JOIN public.options o ON o.id = co.option_id
    WHERE o.question_id = v_q.id;
    SELECT count(*)::INTEGER INTO v_correct_selected
    FROM jsonb_array_elements_text(v_selected) picked(id)
    JOIN public.correct_options co ON co.option_id = picked.id::UUID;
    IF v_test.kind = 'test' AND v_total > 0
       AND v_total = v_correct AND v_correct_selected = v_correct THEN
      v_score := v_score + v_q.points;
    END IF;
  END LOOP;

  v_reason := CASE WHEN v_attempt.expires_at IS NOT NULL
    AND statement_timestamp() >= v_attempt.expires_at
    THEN 'timeout' ELSE 'manual' END;

  INSERT INTO public.submissions(test_id, respondent_id, score, max_score)
  VALUES (v_attempt.test_id, p_respondent_id,
          CASE WHEN v_test.kind = 'test' THEN v_score ELSE NULL END,
          CASE WHEN v_test.kind = 'test' THEN v_max_score ELSE NULL END)
  RETURNING id, submitted_at INTO v_submission_id, v_submitted_at;

  INSERT INTO public.submission_answers(submission_id, option_id)
  SELECT v_submission_id, picked.value::UUID
  FROM jsonb_each(v_attempt.answers) a(question_id, selected)
  CROSS JOIN LATERAL jsonb_array_elements_text(a.selected) picked(value);

  UPDATE public.active_attempts SET status='submitted',
    submission_id=v_submission_id, finished_at=statement_timestamp(),
    finish_reason=v_reason, updated_at=statement_timestamp()
  WHERE id = v_attempt.id;

  RETURN jsonb_build_object('id',v_submission_id,'testId',v_attempt.test_id,
    'kind',v_test.kind,
    'resultVisible',(v_test.kind='test' AND v_test.show_result_immediately),
    'score',CASE WHEN v_test.kind='test' AND v_test.show_result_immediately THEN v_score ELSE NULL END,
    'maxScore',CASE WHEN v_test.kind='test' AND v_test.show_result_immediately THEN v_max_score ELSE NULL END,
    'submittedAt',v_submitted_at,'reason',v_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.evalio_start_active_attempt(UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.evalio_save_active_answer(UUID,UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.evalio_finish_active_attempt(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.evalio_start_active_attempt(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.evalio_save_active_answer(UUID,UUID,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.evalio_finish_active_attempt(UUID,UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
