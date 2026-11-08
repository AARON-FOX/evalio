CREATE OR REPLACE FUNCTION public.evalio_update_question(
  p_test_id UUID,
  p_creator_id UUID,
  p_question_id UUID,
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
  v_correct_count INTEGER;
  v_option RECORD;
  v_option_id UUID;
BEGIN
  -- This test-level lock serializes edits with add_question/publish_test,
  -- both of which lock the same parent test row.
  SELECT t.kind INTO v_kind
  FROM public.tests AS t
  WHERE t.id = p_test_id
    AND t.creator_id = p_creator_id
    AND t.status = 'draft'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_editable';
  END IF;

  -- Defense-in-depth: even an inconsistent draft with past attempts
  -- must never have its options deleted (cascade would erase answers).
  IF EXISTS (
    SELECT 1 FROM public.submissions AS s
    WHERE s.test_id = p_test_id
  ) THEN
    RAISE EXCEPTION 'test_has_submissions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.questions AS q
    WHERE q.id = p_question_id AND q.test_id = p_test_id
  ) THEN
    RAISE EXCEPTION 'question_not_found';
  END IF;

  IF p_text IS NULL
    OR length(btrim(p_text)) NOT BETWEEN 1 AND 5000
    OR p_question_type IS NULL
    OR p_question_type NOT IN ('single_choice', 'multiple_choice')
  THEN
    RAISE EXCEPTION 'invalid_question';
  END IF;

  IF jsonb_typeof(p_options) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_options';
  END IF;

  IF jsonb_array_length(p_options) NOT BETWEEN 2 AND 12 THEN
    RAISE EXCEPTION 'invalid_options_count';
  END IF;

  -- Validate every option BEFORE mutating existing rows.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_options) AS x(item)
    WHERE jsonb_typeof(x.item) IS DISTINCT FROM 'object'
      OR jsonb_typeof(x.item->'text') IS DISTINCT FROM 'string'
      OR length(btrim(x.item->>'text')) NOT BETWEEN 1 AND 1000
      OR jsonb_typeof(x.item->'isCorrect') IS DISTINCT FROM 'boolean'
  ) THEN
    RAISE EXCEPTION 'invalid_option';
  END IF;

  SELECT count(*)::INTEGER INTO v_correct_count
  FROM jsonb_array_elements(p_options) AS x(item)
  WHERE x.item->'isCorrect' = 'true'::jsonb;

  IF v_kind = 'test' THEN
    IF (p_question_type = 'single_choice' AND v_correct_count <> 1)
       OR (p_question_type = 'multiple_choice' AND v_correct_count < 2)
    THEN
      RAISE EXCEPTION 'invalid_correct_answers';
    END IF;
  ELSIF v_correct_count <> 0 THEN
    RAISE EXCEPTION 'survey_has_correct_answers';
  END IF;

  UPDATE public.questions AS q
  SET text = btrim(p_text), question_type = p_question_type
  WHERE q.id = p_question_id AND q.test_id = p_test_id;

  -- Safe only for never-published drafts without submissions.
  -- Cascades correct_options, then creates an entirely new option set.
  DELETE FROM public.options AS o
  WHERE o.question_id = p_question_id;

  FOR v_option IN
    SELECT value AS item, ordinality AS pos
    FROM jsonb_array_elements(p_options) WITH ORDINALITY
  LOOP
    INSERT INTO public.options (question_id, text, position)
    VALUES (p_question_id, btrim(v_option.item->>'text'), v_option.pos::INTEGER)
    RETURNING id INTO v_option_id;

    IF (v_option.item->>'isCorrect')::BOOLEAN THEN
      INSERT INTO public.correct_options (option_id)
      VALUES (v_option_id);
    END IF;
  END LOOP;

  RETURN p_question_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.evalio_delete_question(
  p_test_id UUID,
  p_creator_id UUID,
  p_question_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM public.tests AS t
  WHERE t.id = p_test_id
    AND t.creator_id = p_creator_id
    AND t.status = 'draft'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_editable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.submissions AS s
    WHERE s.test_id = p_test_id
  ) THEN
    RAISE EXCEPTION 'test_has_submissions';
  END IF;

  DELETE FROM public.questions AS q
  WHERE q.id = p_question_id AND q.test_id = p_test_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'question_not_found';
  END IF;

  -- Keep existing positions instead of renumbering them in place.
  -- This avoids unique(test_id, position) collisions. Clients should
  -- render consecutive display numbers based on sorted list index.
END;
$$;

REVOKE ALL ON FUNCTION public.evalio_update_question(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.evalio_delete_question(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.evalio_update_question(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) TO service_role;

GRANT EXECUTE ON FUNCTION public.evalio_delete_question(
  UUID, UUID, UUID
) TO service_role;

NOTIFY pgrst, 'reload schema';
