-- Evalio 012: defense-in-depth. Published versions and their question/answer
-- definitions cannot be edited or deleted, even via an accidental admin route.
-- Requires 009; run after 009-011.
BEGIN;

CREATE OR REPLACE FUNCTION public.evalio_guard_published_test()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'published_version_immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'published' AND ROW(
    NEW.creator_id, NEW.series_id, NEW.version_number,
    NEW.title, NEW.description, NEW.kind, NEW.status, NEW.created_at,
    NEW.subject, NEW.class_group, NEW.duration_minutes, NEW.max_attempts,
    NEW.available_until, NEW.show_result_immediately,
    NEW.show_correct_answers, NEW.shuffle_questions
  ) IS DISTINCT FROM ROW(
    OLD.creator_id, OLD.series_id, OLD.version_number,
    OLD.title, OLD.description, OLD.kind, OLD.status, OLD.created_at,
    OLD.subject, OLD.class_group, OLD.duration_minutes, OLD.max_attempts,
    OLD.available_until, OLD.show_result_immediately,
    OLD.show_correct_answers, OLD.shuffle_questions
  ) THEN
    RAISE EXCEPTION 'published_version_immutable';
  END IF;

  -- is_current may change (true -> false) when publishing a successor.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evalio_guard_published_test_trg ON public.tests;
CREATE TRIGGER evalio_guard_published_test_trg
BEFORE UPDATE OR DELETE ON public.tests
FOR EACH ROW EXECUTE FUNCTION public.evalio_guard_published_test();

CREATE OR REPLACE FUNCTION public.evalio_guard_published_question()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_test_id UUID;
BEGIN
  v_test_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.test_id ELSE NEW.test_id END;

  IF EXISTS (SELECT 1 FROM public.tests
      WHERE id = v_test_id AND status = 'published')
  THEN RAISE EXCEPTION 'published_question_immutable'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF EXISTS (SELECT 1 FROM public.tests
        WHERE id = OLD.test_id AND status = 'published')
    THEN RAISE EXCEPTION 'published_question_immutable'; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evalio_guard_published_question_trg ON public.questions;
CREATE TRIGGER evalio_guard_published_question_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.questions
FOR EACH ROW EXECUTE FUNCTION public.evalio_guard_published_question();

CREATE OR REPLACE FUNCTION public.evalio_guard_published_option()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_question_id UUID;
BEGIN
  v_question_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.question_id ELSE NEW.question_id END;

  IF EXISTS (
    SELECT 1 FROM public.questions q
    JOIN public.tests t ON t.id = q.test_id
    WHERE q.id = v_question_id AND t.status = 'published'
  ) THEN RAISE EXCEPTION 'published_option_immutable'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF EXISTS (
      SELECT 1 FROM public.questions q
      JOIN public.tests t ON t.id = q.test_id
      WHERE q.id = OLD.question_id AND t.status = 'published'
    ) THEN RAISE EXCEPTION 'published_option_immutable'; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evalio_guard_published_option_trg ON public.options;
CREATE TRIGGER evalio_guard_published_option_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.options
FOR EACH ROW EXECUTE FUNCTION public.evalio_guard_published_option();

CREATE OR REPLACE FUNCTION public.evalio_guard_published_key()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_option_id UUID;
BEGIN
  v_option_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.option_id ELSE NEW.option_id END;

  IF EXISTS (
    SELECT 1 FROM public.options o
    JOIN public.questions q ON q.id = o.question_id
    JOIN public.tests t ON t.id = q.test_id
    WHERE o.id = v_option_id AND t.status = 'published'
  ) THEN RAISE EXCEPTION 'published_answer_key_immutable'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF EXISTS (
      SELECT 1 FROM public.options o
      JOIN public.questions q ON q.id = o.question_id
      JOIN public.tests t ON t.id = q.test_id
      WHERE o.id = OLD.option_id AND t.status = 'published'
    ) THEN RAISE EXCEPTION 'published_answer_key_immutable'; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evalio_guard_published_key_trg ON public.correct_options;
CREATE TRIGGER evalio_guard_published_key_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.correct_options
FOR EACH ROW EXECUTE FUNCTION public.evalio_guard_published_key();

COMMIT;
