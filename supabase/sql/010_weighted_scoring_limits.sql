-- Evalio 010: weighted grading, per-series attempt limit and submission deadline.
-- Requires 009_versioning_settings.sql. Replaces only evalio_submit_test.
-- IMPORTANT: no active-attempt clock or autosave is implemented here.
BEGIN;

CREATE OR REPLACE FUNCTION public.evalio_submit_test(
  p_test_id UUID, p_respondent_id UUID, p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_kind TEXT;
  v_series_id UUID;
  v_attempt_limit INTEGER;
  v_deadline TIMESTAMPTZ;
  v_show_result BOOLEAN;
  v_question_count INTEGER;
  v_max_score INTEGER;
  v_score INTEGER := 0;
  v_answer JSONB;
  v_question_id UUID;
  v_question_type TEXT;
  v_question_points INTEGER;
  v_seen UUID[] := ARRAY[]::UUID[];
  v_count INTEGER;
  v_distinct INTEGER;
  v_valid INTEGER;
  v_correct_total INTEGER;
  v_correct_selected INTEGER;
  v_attempts INTEGER;
  v_submission_id UUID;
  v_submitted_at TIMESTAMPTZ;
BEGIN
  -- Share lock serializes publication of a successor with in-flight submission.
  SELECT kind, series_id, max_attempts, available_until, show_result_immediately
  INTO v_kind, v_series_id, v_attempt_limit, v_deadline, v_show_result
  FROM public.tests
  WHERE id = p_test_id AND status = 'published' AND is_current
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'test_not_published'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_respondent_id AND role = 'respondent'
  ) THEN RAISE EXCEPTION 'respondent_required'; END IF;

  IF v_deadline IS NOT NULL AND statement_timestamp() > v_deadline THEN
    RAISE EXCEPTION 'test_deadline_passed';
  END IF;

  -- Serialize submissions from the same student for the same logical test,
  -- avoiding concurrent requests bypassing max_attempts.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_series_id::TEXT || ':' || p_respondent_id::TEXT, 0)
  );

  IF v_attempt_limit IS NOT NULL THEN
    SELECT count(*)::INTEGER INTO v_attempts
    FROM public.submissions s
    JOIN public.tests t ON t.id = s.test_id
    WHERE t.series_id = v_series_id
      AND s.respondent_id = p_respondent_id;
    IF v_attempts >= v_attempt_limit THEN
      RAISE EXCEPTION 'attempt_limit_reached';
    END IF;
  END IF;

  IF jsonb_typeof(p_answers) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_answers';
  END IF;

  SELECT count(*)::INTEGER, coalesce(sum(points), 0)::INTEGER
    INTO v_question_count, v_max_score
  FROM public.questions WHERE test_id = p_test_id;

  IF v_question_count NOT BETWEEN 1 AND 100
     OR jsonb_array_length(p_answers) <> v_question_count
  THEN RAISE EXCEPTION 'invalid_answers_count'; END IF;

  FOR v_answer IN SELECT value FROM jsonb_array_elements(p_answers)
  LOOP
    IF jsonb_typeof(v_answer) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_answer->'questionId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_answer->'optionIds') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'invalid_answer_format'; END IF;

    IF (v_answer->>'questionId') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN RAISE EXCEPTION 'invalid_question_id'; END IF;

    v_question_id := (v_answer->>'questionId')::UUID;
    IF v_question_id = ANY(v_seen) THEN RAISE EXCEPTION 'duplicate_question'; END IF;
    v_seen := array_append(v_seen, v_question_id);

    SELECT question_type, points INTO v_question_type, v_question_points
    FROM public.questions
    WHERE id = v_question_id AND test_id = p_test_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'question_not_in_test'; END IF;

    v_count := jsonb_array_length(v_answer->'optionIds');
    IF v_count NOT BETWEEN 1 AND 12
       OR (v_question_type = 'single_choice' AND v_count <> 1)
    THEN RAISE EXCEPTION 'invalid_option_selection'; END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_answer->'optionIds') AS x(value)
      WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'string'
        OR (x.value #>> '{}') !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) THEN RAISE EXCEPTION 'invalid_option_id'; END IF;

    SELECT count(*)::INTEGER,
           count(DISTINCT picked.id::UUID)::INTEGER,
           count(o.id)::INTEGER,
           count(co.option_id)::INTEGER
    INTO v_count, v_distinct, v_valid, v_correct_selected
    FROM jsonb_array_elements_text(v_answer->'optionIds') AS picked(id)
    LEFT JOIN public.options o
      ON o.id = picked.id::UUID AND o.question_id = v_question_id
    LEFT JOIN public.correct_options co ON co.option_id = o.id;

    IF v_count <> v_distinct OR v_count <> v_valid THEN
      RAISE EXCEPTION 'invalid_option_selection';
    END IF;

    IF v_kind = 'test' THEN
      SELECT count(*)::INTEGER INTO v_correct_total
      FROM public.correct_options co
      JOIN public.options o ON o.id = co.option_id
      WHERE o.question_id = v_question_id;

      -- All-or-nothing grading for each question (including multiple choice).
      IF v_correct_selected = v_correct_total AND v_count = v_correct_total THEN
        v_score := v_score + v_question_points;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.submissions(test_id, respondent_id, score, max_score)
  VALUES (
    p_test_id, p_respondent_id,
    CASE WHEN v_kind = 'test' THEN v_score ELSE NULL END,
    CASE WHEN v_kind = 'test' THEN v_max_score ELSE NULL END
  )
  RETURNING id, submitted_at INTO v_submission_id, v_submitted_at;

  INSERT INTO public.submission_answers(submission_id, option_id)
  SELECT v_submission_id, picked.id::UUID
  FROM jsonb_array_elements(p_answers) AS answer(value)
  CROSS JOIN LATERAL jsonb_array_elements_text(
    answer.value->'optionIds'
  ) AS picked(id);

  -- Visibility is enforced in the API response. The grade is always saved.
  RETURN jsonb_build_object(
    'id', v_submission_id,
    'testId', p_test_id,
    'kind', v_kind,
    'resultVisible', (v_kind = 'test' AND v_show_result),
    'score', CASE WHEN v_kind = 'test' AND v_show_result THEN v_score ELSE NULL END,
    'maxScore', CASE WHEN v_kind = 'test' AND v_show_result THEN v_max_score ELSE NULL END,
    'submittedAt', v_submitted_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evalio_submit_test(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evalio_submit_test(UUID, UUID, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
