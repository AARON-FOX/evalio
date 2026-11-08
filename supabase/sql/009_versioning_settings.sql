-- Evalio 009: immutable published versions, weighted questions and test settings.
-- PREREQUISITES: 003..008 applied, no other migrations running.
-- Run ONCE in Supabase SQL Editor. Keep a database backup before migration.
BEGIN;

ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS series_id UUID,
  ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS class_group TEXT,
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER,
  ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS show_result_immediately BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_correct_answers BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS shuffle_questions BOOLEAN NOT NULL DEFAULT FALSE;

-- Preserve old rows as original version 1. New versions get series_id explicitly;
-- new standalone tests receive an automatic series_id on INSERT.
UPDATE public.tests SET series_id = id WHERE series_id IS NULL;
UPDATE public.tests SET is_current = TRUE
WHERE status = 'published' AND version_number = 1;
ALTER TABLE public.tests ALTER COLUMN series_id SET NOT NULL;
ALTER TABLE public.tests ALTER COLUMN series_id SET DEFAULT gen_random_uuid();

ALTER TABLE public.tests
  ADD CONSTRAINT evalio_version_positive CHECK (version_number >= 1),
  ADD CONSTRAINT evalio_subject_length CHECK (subject IS NULL OR length(subject) <= 120),
  ADD CONSTRAINT evalio_group_length CHECK (class_group IS NULL OR length(class_group) <= 80),
  ADD CONSTRAINT evalio_duration_range CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 180),
  ADD CONSTRAINT evalio_max_attempts_range CHECK (max_attempts IS NULL OR max_attempts BETWEEN 1 AND 20),
  ADD CONSTRAINT evalio_current_published CHECK (NOT is_current OR status = 'published');

CREATE UNIQUE INDEX IF NOT EXISTS evalio_series_version_unique
  ON public.tests(series_id, version_number);
CREATE UNIQUE INDEX IF NOT EXISTS evalio_one_current_published
  ON public.tests(series_id)
  WHERE is_current AND status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS evalio_one_draft_per_series
  ON public.tests(series_id)
  WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS evalio_tests_current_idx
  ON public.tests(status, is_current);

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS explanation TEXT;
ALTER TABLE public.questions
  ADD CONSTRAINT evalio_points_range CHECK (points BETWEEN 1 AND 100),
  ADD CONSTRAINT evalio_explanation_length CHECK (explanation IS NULL OR length(explanation) <= 2000);

-- Public client SELECT policies: older published versions must not be listed as
-- current student assignments. Privileged server queries still check ownership.
DROP POLICY IF EXISTS "Read visible tests" ON public.tests;
CREATE POLICY "Read visible tests" ON public.tests FOR SELECT TO authenticated
USING ((status = 'published' AND is_current) OR creator_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Read visible questions" ON public.questions;
CREATE POLICY "Read visible questions" ON public.questions FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.tests t
  WHERE t.id = questions.test_id
    AND ((t.status = 'published' AND t.is_current) OR t.creator_id = (SELECT auth.uid()))
));

DROP POLICY IF EXISTS "Read visible options" ON public.options;
CREATE POLICY "Read visible options" ON public.options FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.questions q
  JOIN public.tests t ON t.id = q.test_id
  WHERE q.id = options.question_id
    AND ((t.status = 'published' AND t.is_current) OR t.creator_id = (SELECT auth.uid()))
));

-- Clone CURRENT published test into a new independent draft version, including
-- options and answer keys. The old published row is never modified here.
CREATE OR REPLACE FUNCTION public.evalio_create_draft_revision(
  p_test_id UUID, p_creator_id UUID
)
RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_old public.tests%ROWTYPE;
  v_existing UUID;
  v_new UUID;
  v_new_question UUID;
  v_new_option UUID;
  v_q RECORD;
  v_o RECORD;
BEGIN
  SELECT * INTO v_old FROM public.tests t
  WHERE t.id = p_test_id AND t.creator_id = p_creator_id
    AND t.status = 'published' AND t.is_current
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'current_published_test_not_found'; END IF;

  SELECT id INTO v_existing FROM public.tests
  WHERE series_id = v_old.series_id AND status = 'draft';
  IF FOUND THEN RETURN v_existing; END IF;

  INSERT INTO public.tests (
    creator_id, series_id, version_number, is_current, title, description,
    kind, status, subject, class_group, duration_minutes, max_attempts,
    available_until, show_result_immediately, show_correct_answers,
    shuffle_questions
  ) VALUES (
    p_creator_id, v_old.series_id, v_old.version_number + 1, FALSE,
    v_old.title, v_old.description, v_old.kind, 'draft', v_old.subject,
    v_old.class_group, v_old.duration_minutes, v_old.max_attempts,
    v_old.available_until, v_old.show_result_immediately,
    v_old.show_correct_answers, v_old.shuffle_questions
  ) RETURNING id INTO v_new;

  FOR v_q IN SELECT * FROM public.questions WHERE test_id = v_old.id ORDER BY position LOOP
    INSERT INTO public.questions (
      test_id, text, question_type, position, points, explanation
    ) VALUES (
      v_new, v_q.text, v_q.question_type, v_q.position,
      v_q.points, v_q.explanation
    ) RETURNING id INTO v_new_question;

    FOR v_o IN SELECT * FROM public.options WHERE question_id = v_q.id ORDER BY position LOOP
      INSERT INTO public.options (question_id, text, position)
      VALUES (v_new_question, v_o.text, v_o.position)
      RETURNING id INTO v_new_option;

      IF EXISTS (SELECT 1 FROM public.correct_options WHERE option_id = v_o.id) THEN
        INSERT INTO public.correct_options(option_id) VALUES (v_new_option);
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_new;
END;
$$;

-- Wrap EXISTING validated and atomic add/edit logic without breaking legacy RPC
-- signatures. Both metadata fields are saved in the same DB transaction.
CREATE OR REPLACE FUNCTION public.evalio_add_question_v2(
  p_test_id UUID, p_creator_id UUID, p_text TEXT,
  p_question_type TEXT, p_options JSONB,
  p_points INTEGER, p_explanation TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_id UUID;
BEGIN
  IF p_points IS NULL OR p_points NOT BETWEEN 1 AND 100
     OR (p_explanation IS NOT NULL AND length(p_explanation) > 2000)
  THEN RAISE EXCEPTION 'invalid_question_metadata'; END IF;

  v_id := public.evalio_add_question(
    p_test_id, p_creator_id, p_text, p_question_type, p_options
  );
  UPDATE public.questions SET points = p_points,
    explanation = NULLIF(btrim(p_explanation), '')
  WHERE id = v_id AND test_id = p_test_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.evalio_update_question_v2(
  p_test_id UUID, p_creator_id UUID, p_question_id UUID,
  p_text TEXT, p_question_type TEXT, p_options JSONB,
  p_points INTEGER, p_explanation TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_id UUID;
BEGIN
  IF p_points IS NULL OR p_points NOT BETWEEN 1 AND 100
     OR (p_explanation IS NOT NULL AND length(p_explanation) > 2000)
  THEN RAISE EXCEPTION 'invalid_question_metadata'; END IF;

  v_id := public.evalio_update_question(
    p_test_id, p_creator_id, p_question_id, p_text, p_question_type, p_options
  );
  UPDATE public.questions SET points = p_points,
    explanation = NULLIF(btrim(p_explanation), '')
  WHERE id = v_id AND test_id = p_test_id;
  RETURN v_id;
END;
$$;

-- Publish replaces the *current pointer*, not the previously published data.
CREATE OR REPLACE FUNCTION public.evalio_publish_test(
  p_test_id UUID, p_creator_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_test public.tests%ROWTYPE;
  v_qcount INTEGER;
BEGIN
  SELECT * INTO v_test FROM public.tests
  WHERE id = p_test_id AND creator_id = p_creator_id AND status = 'draft'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'draft_not_editable'; END IF;

  SELECT count(*)::INTEGER INTO v_qcount
  FROM public.questions WHERE test_id = v_test.id;
  IF v_qcount = 0 THEN RAISE EXCEPTION 'test_has_no_questions'; END IF;
  IF v_qcount > 100 THEN RAISE EXCEPTION 'invalid_questions_count'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.questions q
    CROSS JOIN LATERAL (
      SELECT COUNT(*) AS option_count, COUNT(co.option_id) AS correct_count
      FROM public.options o
      LEFT JOIN public.correct_options co ON co.option_id = o.id
      WHERE o.question_id = q.id
    ) totals
    WHERE q.test_id = v_test.id AND (
      totals.option_count NOT BETWEEN 2 AND 12
      OR q.points NOT BETWEEN 1 AND 100
      OR (v_test.kind = 'test' AND (
        (q.question_type = 'single_choice' AND totals.correct_count <> 1)
        OR (q.question_type = 'multiple_choice' AND totals.correct_count < 2)
      ))
      OR (v_test.kind = 'survey' AND totals.correct_count <> 0)
    )
  ) THEN RAISE EXCEPTION 'test_has_invalid_questions'; END IF;

  -- Lock the currently published version and retire its CURRENT marker.
  PERFORM 1 FROM public.tests
  WHERE series_id = v_test.series_id AND status = 'published' AND is_current
  FOR UPDATE;
  UPDATE public.tests SET is_current = FALSE
  WHERE series_id = v_test.series_id AND status = 'published' AND is_current;

  UPDATE public.tests SET status = 'published', is_current = TRUE
  WHERE id = v_test.id AND status = 'draft';
END;
$$;

REVOKE ALL ON FUNCTION public.evalio_create_draft_revision(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evalio_add_question_v2(UUID, UUID, TEXT, TEXT, JSONB, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evalio_update_question_v2(UUID, UUID, UUID, TEXT, TEXT, JSONB, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evalio_create_draft_revision(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.evalio_add_question_v2(UUID, UUID, TEXT, TEXT, JSONB, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.evalio_update_question_v2(UUID, UUID, UUID, TEXT, TEXT, JSONB, INTEGER, TEXT) TO service_role;

-- Previous publish RPC is already restricted by migration 004; restate explicitly.
REVOKE ALL ON FUNCTION public.evalio_publish_test(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evalio_publish_test(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
