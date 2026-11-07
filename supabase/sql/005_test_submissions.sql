
CREATE OR REPLACE FUNCTION public.evalio_submit_test(
  p_test_id UUID,
  p_respondent_id UUID,
  p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_kind TEXT;
  v_question_count INTEGER;
  v_score INTEGER := 0;

  v_answer JSONB;
  v_question_id UUID;
  v_question_type TEXT;
  v_seen UUID[] := ARRAY[]::UUID[];

  v_count INTEGER;
  v_distinct INTEGER;
  v_valid INTEGER;
  v_correct_total INTEGER;
  v_correct_selected INTEGER;

  v_submission_id UUID;
  v_submitted_at TIMESTAMPTZ;
BEGIN
  -- Published tests only
  SELECT kind INTO v_kind
  FROM public.tests
  WHERE id = p_test_id
    AND status = 'published'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'test_not_published';
  END IF;

  -- Verify the respondent in the database too
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_respondent_id
      AND role = 'respondent'
  ) THEN
    RAISE EXCEPTION 'respondent_required';
  END IF;

  IF jsonb_typeof(p_answers) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_answers';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_question_count
  FROM public.questions
  WHERE test_id = p_test_id;

  -- Exactly one answer group per question
  IF v_question_count = 0
     OR v_question_count > 100
     OR jsonb_array_length(p_answers) <> v_question_count
  THEN
    RAISE EXCEPTION 'invalid_answers_count';
  END IF;

  FOR v_answer IN
    SELECT value FROM jsonb_array_elements(p_answers)
  LOOP
    IF jsonb_typeof(v_answer) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_answer->'questionId')
          IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_answer->'optionIds')
          IS DISTINCT FROM 'array'
    THEN
      RAISE EXCEPTION 'invalid_answer_format';
    END IF;

    IF (v_answer->>'questionId') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
      RAISE EXCEPTION 'invalid_question_id';
    END IF;

    v_question_id := (v_answer->>'questionId')::UUID;

    IF v_question_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'duplicate_question';
    END IF;

    v_seen := array_append(v_seen, v_question_id);

    SELECT question_type INTO v_question_type
    FROM public.questions
    WHERE id = v_question_id
      AND test_id = p_test_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'question_not_in_test';
    END IF;

    v_count := jsonb_array_length(
      v_answer->'optionIds'
    );

    IF v_count < 1 OR v_count > 12 OR
       (v_question_type = 'single_choice' AND v_count <> 1)
    THEN
      RAISE EXCEPTION 'invalid_option_selection';
    END IF;

    -- Every selected option must be a UUID string
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        v_answer->'optionIds'
      ) AS picked(value)
      WHERE jsonb_typeof(picked.value)
          IS DISTINCT FROM 'string'
        OR (picked.value #>> '{}') !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) THEN
      RAISE EXCEPTION 'invalid_option_id';
    END IF;

    SELECT
      COUNT(*)::INTEGER,
      COUNT(DISTINCT picked.id)::INTEGER,
      COUNT(o.id)::INTEGER,
      COUNT(co.option_id)::INTEGER
    INTO
      v_count,
      v_distinct,
      v_valid,
      v_correct_selected
    FROM jsonb_array_elements_text(
      v_answer->'optionIds'
    ) AS picked(id)
    LEFT JOIN public.options o
      ON o.id = picked.id::UUID
      AND o.question_id = v_question_id
    LEFT JOIN public.correct_options co
      ON co.option_id = o.id;

    IF v_count <> v_distinct OR v_count <> v_valid THEN
      RAISE EXCEPTION 'invalid_option_selection';
    END IF;

    -- Exact matching for test questions
    IF v_kind = 'test' THEN
      SELECT COUNT(*)::INTEGER
      INTO v_correct_total
      FROM public.options o
      JOIN public.correct_options co
        ON co.option_id = o.id
      WHERE o.question_id = v_question_id;

      IF v_correct_selected = v_correct_total
         AND v_count = v_correct_total
      THEN
        v_score := v_score + 1;
      END IF;
    END IF;
  END LOOP;

  -- Insert submission only after validation
  INSERT INTO public.submissions (
    test_id,
    respondent_id,
    score,
    max_score
  )
  VALUES (
    p_test_id,
    p_respondent_id,
    CASE WHEN v_kind = 'test'
      THEN v_score ELSE NULL END,
    CASE WHEN v_kind = 'test'
      THEN v_question_count ELSE NULL END
  )
  RETURNING id, submitted_at
  INTO v_submission_id, v_submitted_at;

  -- Insert selected options
  INSERT INTO public.submission_answers (
    submission_id,
    option_id
  )
  SELECT
    v_submission_id,
    picked.id::UUID
  FROM jsonb_array_elements(p_answers) AS answer
  CROSS JOIN LATERAL jsonb_array_elements_text(
    answer->'optionIds'
  ) AS picked(id);

  RETURN jsonb_build_object(
    'id', v_submission_id,
    'testId', p_test_id,
    'score', CASE WHEN v_kind = 'test'
      THEN v_score ELSE NULL END,
    'maxScore', CASE WHEN v_kind = 'test'
      THEN v_question_count ELSE NULL END,
    'submittedAt', v_submitted_at
  );
END;
$$;

-- Only the trusted backend may execute the function
REVOKE ALL ON FUNCTION public.evalio_submit_test(
  UUID, UUID, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.evalio_submit_test(
  UUID, UUID, JSONB
) TO service_role;

NOTIFY pgrst, 'reload schema';
