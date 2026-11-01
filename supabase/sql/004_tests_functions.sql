CREATE OR REPLACE FUNCTION public.evalio_add_question(
  p_test_id UUID,
  p_creator_id UUID,
  p_text TEXT,
  p_question_type TEXT,
  p_options JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_kind TEXT;
  v_question_id UUID;
  v_option_id UUID;
  v_position INTEGER;
  v_correct_count INTEGER;
  v_option RECORD;
BEGIN
  -- Lock the draft while adding a question.
  SELECT kind INTO v_kind
  FROM public.tests
  WHERE id = p_test_id
    AND creator_id = p_creator_id
    AND status = 'draft'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'test_not_editable';
  END IF;

  IF p_question_type IS NULL
     OR p_question_type NOT IN (
       'single_choice', 'multiple_choice'
     )
     OR NULLIF(BTRIM(p_text), '') IS NULL
  THEN
    RAISE EXCEPTION 'invalid_question';
  END IF;

  IF jsonb_typeof(p_options) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_options';
  END IF;

  IF jsonb_array_length(p_options) < 2
     OR jsonb_array_length(p_options) > 12
  THEN
    RAISE EXCEPTION 'invalid_options_count';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_correct_count
  FROM jsonb_array_elements(p_options) AS item
  WHERE item->>'isCorrect' = 'true';

  IF v_kind = 'test' THEN
    IF (
      p_question_type = 'single_choice'
      AND v_correct_count <> 1
    ) OR (
      p_question_type = 'multiple_choice'
      AND v_correct_count < 2
    ) THEN
      RAISE EXCEPTION 'invalid_correct_answers';
    END IF;
  ELSIF v_correct_count <> 0 THEN
    RAISE EXCEPTION 'survey_has_correct_answers';
  END IF;

  SELECT COALESCE(MAX(position), 0) + 1
  INTO v_position
  FROM public.questions
  WHERE test_id = p_test_id;

  INSERT INTO public.questions (
    test_id, text, question_type, position
  )
  VALUES (
    p_test_id, p_text, p_question_type, v_position
  )
  RETURNING id INTO v_question_id;

  FOR v_option IN
    SELECT value AS item, ordinality AS pos
    FROM jsonb_array_elements(p_options)
    WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_option.item)
         IS DISTINCT FROM 'object'
       OR NULLIF(BTRIM(v_option.item->>'text'), '')
         IS NULL
       OR jsonb_typeof(v_option.item->'isCorrect')
         IS DISTINCT FROM 'boolean'
    THEN
      RAISE EXCEPTION 'invalid_option';
    END IF;

    INSERT INTO public.options (
      question_id, text, position
    )
    VALUES (
      v_question_id,
      v_option.item->>'text',
      v_option.pos::INTEGER
    )
    RETURNING id INTO v_option_id;

    IF (v_option.item->>'isCorrect')::BOOLEAN THEN
      INSERT INTO public.correct_options (option_id)
      VALUES (v_option_id);
    END IF;
  END LOOP;

  RETURN v_question_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.evalio_publish_test(
  p_test_id UUID,
  p_creator_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_kind TEXT;
  v_status TEXT;
BEGIN
  SELECT kind, status INTO v_kind, v_status
  FROM public.tests
  WHERE id = p_test_id
    AND creator_id = p_creator_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'test_not_found';
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'test_already_published';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.questions
    WHERE test_id = p_test_id
  ) THEN
    RAISE EXCEPTION 'test_has_no_questions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.questions q
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS option_count,
        COUNT(co.option_id) AS correct_count
      FROM public.options o
      LEFT JOIN public.correct_options co
        ON co.option_id = o.id
      WHERE o.question_id = q.id
    ) totals ON TRUE
    WHERE q.test_id = p_test_id
      AND (
        totals.option_count < 2
        OR (
          v_kind = 'test'
          AND (
            (q.question_type = 'single_choice'
              AND totals.correct_count <> 1)
            OR
            (q.question_type = 'multiple_choice'
              AND totals.correct_count < 2)
          )
        )
        OR (
          v_kind = 'survey'
          AND totals.correct_count <> 0
        )
      )
  ) THEN
    RAISE EXCEPTION 'test_has_invalid_questions';
  END IF;

  UPDATE public.tests
  SET status = 'published'
  WHERE id = p_test_id;
END;
$$;

-- Do not allow public or authenticated clients
-- to execute privileged write functions.

REVOKE ALL ON FUNCTION public.evalio_add_question(
  UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.evalio_publish_test(
  UUID, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.evalio_add_question(
  UUID, UUID, TEXT, TEXT, JSONB
) TO service_role;

GRANT EXECUTE ON FUNCTION public.evalio_publish_test(
  UUID, UUID
) TO service_role;
