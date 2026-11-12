BEGIN;

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('evalio-test-images','evalio-test-images', false, 3145728,
        ARRAY['image/jpeg','image/png','image/webp','image/gif']::text[])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 3145728,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE public.options
  ADD COLUMN IF NOT EXISTS image_path TEXT,
  ADD COLUMN IF NOT EXISTS image_only BOOLEAN NOT NULL DEFAULT FALSE;

-- The original DB constraint requires text, and we retain it for backward
-- compatibility. Image-only answers store an accessible fallback label
-- such as 'Варіант 1', while image_only controls visual rendering.
ALTER TABLE public.questions
  ADD CONSTRAINT evalio_question_image_path_format CHECK (
    image_path IS NULL OR image_path ~
    '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif)$'
  );
ALTER TABLE public.options
  ADD CONSTRAINT evalio_option_image_path_format CHECK (
    image_path IS NULL OR image_path ~
    '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif)$'
  ),
  ADD CONSTRAINT evalio_image_only_requires_image CHECK (
    NOT image_only OR image_path IS NOT NULL
  );

-- The frontend is not allowed to read raw private object paths through
-- the Supabase REST API; only the Express service role reads these columns.
REVOKE SELECT ON public.questions, public.options FROM authenticated;
GRANT SELECT (id,test_id,text,question_type,position,points)
  ON public.questions TO authenticated;
GRANT SELECT (id,question_id,text,position)
  ON public.options TO authenticated;

-- Atomically add a question and attach its media. The legacy validation,
-- correct-answer checks and transactional locks remain in the v2 RPC.
CREATE OR REPLACE FUNCTION public.evalio_add_question_media(
  p_test_id UUID, p_creator_id UUID, p_text TEXT,
  p_question_type TEXT, p_options JSONB, p_points INTEGER,
  p_explanation TEXT, p_image_path TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_id UUID;
  v_opt RECORD;
BEGIN
  IF p_image_path IS NOT NULL AND (
    left(p_image_path, length(p_creator_id::TEXT) + 1) <> p_creator_id::TEXT || '/'
  ) THEN RAISE EXCEPTION 'invalid_media_owner'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_options) AS e(item)
    WHERE (nullif(e.item->>'imagePath','') IS NOT NULL AND
      left(e.item->>'imagePath', length(p_creator_id::TEXT) + 1) <> p_creator_id::TEXT || '/')
      OR (e.item->>'imageOnly' = 'true' AND nullif(e.item->>'imagePath','') IS NULL)
  ) THEN RAISE EXCEPTION 'invalid_media_owner'; END IF;

  v_id := public.evalio_add_question_v2(
    p_test_id,p_creator_id,p_text,p_question_type,p_options,p_points,p_explanation
  );
  UPDATE public.questions SET image_path = p_image_path WHERE id=v_id;
  FOR v_opt IN
    SELECT ordinality::INTEGER AS pos, value AS item
    FROM jsonb_array_elements(p_options) WITH ORDINALITY
  LOOP
    UPDATE public.options
    SET image_path = nullif(v_opt.item->>'imagePath',''),
        image_only = coalesce((v_opt.item->>'imageOnly')::BOOLEAN, false)
    WHERE question_id=v_id AND position=v_opt.pos;
  END LOOP;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.evalio_update_question_media(
  p_test_id UUID, p_creator_id UUID, p_question_id UUID,
  p_text TEXT, p_question_type TEXT, p_options JSONB,
  p_points INTEGER, p_explanation TEXT, p_image_path TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_id UUID;
  v_opt RECORD;
BEGIN
  IF p_image_path IS NOT NULL AND (
    left(p_image_path, length(p_creator_id::TEXT) + 1) <> p_creator_id::TEXT || '/'
  ) THEN RAISE EXCEPTION 'invalid_media_owner'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_options) AS e(item)
    WHERE (nullif(e.item->>'imagePath','') IS NOT NULL AND
      left(e.item->>'imagePath', length(p_creator_id::TEXT) + 1) <> p_creator_id::TEXT || '/')
      OR (e.item->>'imageOnly' = 'true' AND nullif(e.item->>'imagePath','') IS NULL)
  ) THEN RAISE EXCEPTION 'invalid_media_owner'; END IF;

  v_id := public.evalio_update_question_v2(
    p_test_id,p_creator_id,p_question_id,p_text,p_question_type,
    p_options,p_points,p_explanation
  );
  UPDATE public.questions SET image_path = p_image_path WHERE id=v_id;
  FOR v_opt IN
    SELECT ordinality::INTEGER AS pos, value AS item
    FROM jsonb_array_elements(p_options) WITH ORDINALITY
  LOOP
    UPDATE public.options
    SET image_path = nullif(v_opt.item->>'imagePath',''),
        image_only = coalesce((v_opt.item->>'imageOnly')::BOOLEAN, false)
    WHERE question_id=v_id AND position=v_opt.pos;
  END LOOP;
  RETURN v_id;
END;
$$;

-- Clone media references along with each new version. The objects themselves
-- are immutable UUID-named files: never overwrite them or delete them when
-- an individual draft question is edited.
CREATE OR REPLACE FUNCTION public.evalio_create_draft_revision(
  p_test_id UUID, p_creator_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
      test_id, text, question_type, position, points, explanation, image_path
    ) VALUES (
      v_new, v_q.text, v_q.question_type, v_q.position,
      v_q.points, v_q.explanation, v_q.image_path
    ) RETURNING id INTO v_new_question;

    FOR v_o IN SELECT * FROM public.options WHERE question_id = v_q.id ORDER BY position LOOP
      INSERT INTO public.options (question_id, text, position, image_path, image_only)
      VALUES (v_new_question, v_o.text, v_o.position, v_o.image_path, v_o.image_only)
      RETURNING id INTO v_new_option;
      IF EXISTS (SELECT 1 FROM public.correct_options WHERE option_id = v_o.id) THEN
        INSERT INTO public.correct_options(option_id) VALUES (v_new_option);
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.evalio_add_question_media(UUID,UUID,TEXT,TEXT,JSONB,INTEGER,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evalio_update_question_media(UUID,UUID,UUID,TEXT,TEXT,JSONB,INTEGER,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evalio_add_question_media(UUID,UUID,TEXT,TEXT,JSONB,INTEGER,TEXT,TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.evalio_update_question_media(UUID,UUID,UUID,TEXT,TEXT,JSONB,INTEGER,TEXT,TEXT)
  TO service_role;
-- evalio_create_draft_revision retains the service_role-only grants from 009.
NOTIFY pgrst, 'reload schema';
COMMIT;
