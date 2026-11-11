-- Evalio 014: super-admin role management
-- Apply ONCE after 013_active_attempts.sql. Back up the database first.
BEGIN;

-- Original migration 002 created this named check constraint.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('respondent', 'creator', 'admin'));

-- No direct role writes are allowed to logged-in browser clients.
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.admin_role_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id UUID NOT NULL,
  target_id UUID NOT NULL,
  old_role TEXT NOT NULL CHECK (old_role IN ('respondent', 'creator')),
  new_role TEXT NOT NULL CHECK (new_role IN ('respondent', 'creator')),
  reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_role_changed CHECK (old_role <> new_role)
);

CREATE INDEX IF NOT EXISTS admin_role_audit_changed_at_idx
  ON public.admin_role_audit(changed_at DESC);

ALTER TABLE public.admin_role_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_role_audit FROM PUBLIC, anon, authenticated;

-- Service-role-only RPC. The database rechecks the actor's CURRENT profile.
CREATE OR REPLACE FUNCTION public.evalio_admin_list_users(
  p_actor_id UUID,
  p_search TEXT DEFAULT '',
  p_role TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total BIGINT;
  v_items JSONB;
  v_summary JSONB;
  v_search TEXT := LEFT(BTRIM(COALESCE(p_search, '')), 100);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  IF p_page < 1 OR p_page > 100000 OR p_page_size < 1 OR p_page_size > 100
     OR (p_role IS NOT NULL AND p_role NOT IN ('respondent','creator','admin')) THEN
    RAISE EXCEPTION 'invalid_admin_query' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE (p_role IS NULL OR p.role = p_role)
    AND (v_search = '' OR COALESCE(u.email, '') ILIKE '%' || v_search || '%');

  SELECT COALESCE(jsonb_agg(to_jsonb(item)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT p.id, u.email, p.role, p.created_at AS created_at,
           u.email_confirmed_at, u.last_sign_in_at
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE (p_role IS NULL OR p.role = p_role)
      AND (v_search = '' OR COALESCE(u.email, '') ILIKE '%' || v_search || '%')
    ORDER BY p.created_at DESC, p.id
    LIMIT p_page_size OFFSET ((p_page - 1) * p_page_size)
  ) item;

  SELECT jsonb_build_object(
    'total', COUNT(*),
    'respondents', COUNT(*) FILTER (WHERE role = 'respondent'),
    'creators', COUNT(*) FILTER (WHERE role = 'creator'),
    'admins', COUNT(*) FILTER (WHERE role = 'admin')
  ) INTO v_summary FROM public.profiles;

  RETURN jsonb_build_object(
    'items', v_items, 'total', v_total,
    'page', p_page, 'pageSize', p_page_size,
    'summary', v_summary
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.evalio_admin_change_role(
  p_actor_id UUID,
  p_target_id UUID,
  p_new_role TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_role TEXT;
  v_old_role TEXT;
  v_new_role TEXT := BTRIM(COALESCE(p_new_role, ''));
  v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
BEGIN
  IF v_new_role NOT IN ('respondent','creator') OR
     LENGTH(COALESCE(p_reason, '')) > 300 THEN
    RAISE EXCEPTION 'invalid_role_change' USING ERRCODE = '22023';
  END IF;

  IF p_actor_id = p_target_id THEN
    RAISE EXCEPTION 'cannot_change_self' USING ERRCODE = '23514';
  END IF;

  -- Serialize changes; lock the actor to prevent concurrent demotion in this transaction.
  SELECT role INTO v_actor_role
    FROM public.profiles WHERE id = p_actor_id FOR UPDATE;
  IF v_actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_old_role
    FROM public.profiles WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_old_role = 'admin' THEN
    RAISE EXCEPTION 'cannot_change_admin' USING ERRCODE = '23514';
  END IF;

  -- Do not strand in-progress respondents by revoking respondent access.
  IF v_old_role = 'respondent' AND v_new_role = 'creator' AND EXISTS (
    SELECT 1 FROM public.active_attempts
    WHERE respondent_id = p_target_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'user_has_active_attempt' USING ERRCODE = '23514';
  END IF;
  IF v_old_role = v_new_role THEN
    RETURN jsonb_build_object('id', p_target_id, 'role', v_old_role, 'changed', false);
  END IF;

  UPDATE public.profiles SET role = v_new_role WHERE id = p_target_id;
  INSERT INTO public.admin_role_audit(actor_id, target_id, old_role, new_role, reason)
  VALUES (p_actor_id, p_target_id, v_old_role, v_new_role, v_reason);

  RETURN jsonb_build_object('id', p_target_id, 'role', v_new_role, 'changed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.evalio_admin_role_audit(
  p_actor_id UUID,
  p_limit INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_items JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid_admin_query' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(item)), '[]'::jsonb) INTO v_items FROM (
    SELECT a.id, a.actor_id, actor.email AS actor_email,
           a.target_id, target.email AS target_email,
           a.old_role, a.new_role, a.reason, a.changed_at
    FROM public.admin_role_audit a
    LEFT JOIN auth.users actor ON actor.id = a.actor_id
    LEFT JOIN auth.users target ON target.id = a.target_id
    ORDER BY a.changed_at DESC, a.id DESC
    LIMIT p_limit
  ) item;
  RETURN v_items;
END;
$$;

REVOKE ALL ON FUNCTION public.evalio_admin_list_users(UUID,TEXT,TEXT,INTEGER,INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evalio_admin_change_role(UUID,UUID,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evalio_admin_role_audit(UUID,INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.evalio_admin_list_users(UUID,TEXT,TEXT,INTEGER,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.evalio_admin_change_role(UUID,UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.evalio_admin_role_audit(UUID,INTEGER) TO service_role;

COMMIT;
