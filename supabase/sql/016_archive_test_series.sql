BEGIN;

CREATE TABLE public.archived_test_series (
  series_id UUID PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  archived_by UUID NOT NULL REFERENCES public.profiles(id)
);

CREATE INDEX archived_test_series_creator_idx
  ON public.archived_test_series(creator_id);

ALTER TABLE public.archived_test_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.archived_test_series FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.archived_test_series TO service_role;

-- Stable security-definer read helper for RLS and dashboard queries.
-- Does not expose the archive table or its owner to browser clients.
CREATE FUNCTION public.evalio_series_archived(p_series_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.archived_test_series a
    WHERE a.series_id = p_series_id
  );
$$;
REVOKE ALL ON FUNCTION public.evalio_series_archived(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evalio_series_archived(UUID) TO authenticated, service_role;

-- Server-side view keeps pagination correct: archived series are filtered
-- BEFORE ORDER BY / LIMIT / OFFSET, not after the page is fetched.
CREATE VIEW public.evalio_unarchived_tests
WITH (security_invoker = true)
AS SELECT t.* FROM public.tests t
WHERE NOT public.evalio_series_archived(t.series_id);
REVOKE ALL ON public.evalio_unarchived_tests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.evalio_unarchived_tests TO service_role;

-- Original published question/version rows are not deleted or updated.
-- Remove archived tests from direct authenticated SELECT (own drafts included).
DROP POLICY IF EXISTS "Read visible tests" ON public.tests;
CREATE POLICY "Read visible tests" ON public.tests FOR SELECT TO authenticated
USING (
  NOT public.evalio_series_archived(series_id)
  AND ((status = 'published' AND is_current) OR creator_id = (SELECT auth.uid()))
);

-- Archive all versions of a logical test via one server-only RPC.
CREATE FUNCTION public.evalio_archive_test_series(
  p_test_id UUID, p_creator_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_series_id UUID;
  v_creator UUID;
  v_archive_time TIMESTAMPTZ;
BEGIN
  SELECT t.series_id, t.creator_id INTO v_series_id, v_creator
  FROM public.tests t WHERE t.id = p_test_id FOR UPDATE;
  IF NOT FOUND OR v_creator <> p_creator_id THEN
    RAISE EXCEPTION 'test_not_owned';
  END IF;

  -- Synchronize against evalio_start_active_attempt's SELECT FOR SHARE.
  PERFORM 1 FROM public.tests t
  WHERE t.series_id = v_series_id AND t.status = 'published' AND t.is_current
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.active_attempts a
    WHERE a.series_id = v_series_id AND a.status = 'active'
  ) THEN
    RAISE EXCEPTION 'test_has_active_attempts';
  END IF;

  INSERT INTO public.archived_test_series(series_id, creator_id, archived_by)
  VALUES (v_series_id, v_creator, p_creator_id)
  ON CONFLICT (series_id) DO NOTHING;

  SELECT archived_at INTO v_archive_time FROM public.archived_test_series
  WHERE series_id = v_series_id;
  RETURN jsonb_build_object('seriesId', v_series_id, 'archivedAt', v_archive_time);
END;
$$;
REVOKE ALL ON FUNCTION public.evalio_archive_test_series(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evalio_archive_test_series(UUID, UUID)
  TO service_role;

-- Defense in depth: archive prevents a new active attempt even if an outdated
-- client bypasses the catalog or a start RPC was already in flight.
CREATE FUNCTION public.evalio_block_archived_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_series UUID;
BEGIN
  SELECT t.series_id INTO v_series FROM public.tests t
  WHERE t.id = NEW.test_id FOR SHARE;
  IF public.evalio_series_archived(v_series) THEN
    RAISE EXCEPTION 'test_archived';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evalio_block_archived_attempt_trg
BEFORE INSERT ON public.active_attempts
FOR EACH ROW EXECUTE FUNCTION public.evalio_block_archived_attempt();

-- Legacy/direct server submission paths must not create new results for archives.
CREATE TRIGGER evalio_block_archived_submission_trg
BEFORE INSERT ON public.submissions
FOR EACH ROW EXECUTE FUNCTION public.evalio_block_archived_attempt();

-- Do not allow creating a successor version of a test after archiving.
CREATE FUNCTION public.evalio_guard_archived_test_write()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF public.evalio_series_archived(NEW.series_id) THEN
    RAISE EXCEPTION 'test_archived';
  END IF;
  IF TG_OP = 'UPDATE' AND public.evalio_series_archived(OLD.series_id) THEN
    RAISE EXCEPTION 'test_archived';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evalio_guard_archived_test_write_trg
BEFORE INSERT OR UPDATE ON public.tests
FOR EACH ROW EXECUTE FUNCTION public.evalio_guard_archived_test_write();

-- Refresh existing dashboard functions with archive-aware ACTIVE test totals.
-- Student completed-history stats intentionally retain archived submissions.
CREATE OR REPLACE FUNCTION public.evalio_creator_dashboard(
  p_creator_id UUID,
  p_page INTEGER DEFAULT 1,
  p_status TEXT DEFAULT 'all',
  p_search TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_stats JSONB;
  v_attempts JSONB;
  v_items JSONB;
  v_recent JSONB;
  v_filtered BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_creator_id AND role = 'creator'
  ) THEN
    RAISE EXCEPTION 'creator_required';
  END IF;

  IF p_page IS NULL OR p_page < 1 OR p_page > 10000
    OR p_status IS NULL OR p_status NOT IN ('all', 'draft', 'published')
    OR p_search IS NULL OR LENGTH(p_search) > 100
  THEN
    RAISE EXCEPTION 'invalid_dashboard_query';
  END IF;

  SELECT jsonb_build_object(
    'totalTests', COUNT(DISTINCT series_id),
    'publishedTests', COUNT(DISTINCT series_id) FILTER (WHERE status = 'published' AND is_current),
    'draftTests', COUNT(DISTINCT series_id) FILTER (WHERE status = 'draft')
  ) INTO v_stats
  FROM public.tests t
  WHERE t.creator_id = p_creator_id
    AND NOT public.evalio_series_archived(t.series_id);

  SELECT jsonb_build_object(
    'totalAttempts', COUNT(*),
    'averagePercent', ROUND(AVG(100.0 * s.score / NULLIF(s.max_score, 0)), 1)
  ) INTO v_attempts
  FROM public.submissions s
  JOIN public.tests t ON t.id = s.test_id
  WHERE t.creator_id = p_creator_id
    AND NOT public.evalio_series_archived(t.series_id);

  SELECT COUNT(*) INTO v_filtered
  FROM public.tests t
  WHERE t.creator_id = p_creator_id
    AND NOT public.evalio_series_archived(t.series_id)
    AND (t.status = 'draft' OR t.is_current)
    AND (p_status = 'all' OR t.status = p_status)
    AND NOT (
      p_status = 'all' AND t.status = 'published' AND EXISTS (
        SELECT 1 FROM public.tests d
        WHERE d.series_id = t.series_id AND d.status = 'draft'
      )
    )
    AND (BTRIM(p_search) = '' OR t.title ILIKE '%' || BTRIM(p_search) || '%');

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'seriesId', t.series_id,
        'versionNumber', t.version_number,
        'isCurrent', t.is_current,
        'title', t.title,
        'description', t.description,
        'kind', t.kind,
        'status', t.status,
        'createdAt', t.created_at,
        'participantCount', sr.participants,
        'averagePercent', sr.avg_percent
      ) ORDER BY t.created_at DESC, t.id DESC
    ),
    '[]'::jsonb
  ) INTO v_items
  FROM (
    SELECT * FROM public.tests t
    WHERE t.creator_id = p_creator_id
      AND NOT public.evalio_series_archived(t.series_id)
      AND (t.status = 'draft' OR t.is_current)
      AND (p_status = 'all' OR t.status = p_status)
      AND NOT (
        p_status = 'all' AND t.status = 'published' AND EXISTS (
          SELECT 1 FROM public.tests d
          WHERE d.series_id = t.series_id AND d.status = 'draft'
        )
      )
      AND (BTRIM(p_search) = '' OR t.title ILIKE '%' || BTRIM(p_search) || '%')
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT 10 OFFSET ((p_page - 1) * 10)
  ) t
  CROSS JOIN LATERAL (
    SELECT
      COUNT(DISTINCT s.respondent_id)::INTEGER AS participants,
      ROUND(AVG(100.0 * s.score / NULLIF(s.max_score, 0)), 1) AS avg_percent
    FROM public.submissions s
    WHERE s.test_id = t.id
  ) sr;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', recent.id,
        'testId', recent.test_id,
        'testTitle', recent.title,
        'respondentId', recent.respondent_id,
        'score', recent.score,
        'maxScore', recent.max_score,
        'submittedAt', recent.submitted_at
      ) ORDER BY recent.submitted_at DESC, recent.id DESC
    ),
    '[]'::jsonb
  ) INTO v_recent
  FROM (
    SELECT s.id, s.test_id, s.respondent_id, s.score,
           s.max_score, s.submitted_at, t.title
    FROM public.submissions s
    JOIN public.tests t ON t.id = s.test_id
    WHERE t.creator_id = p_creator_id
      AND NOT public.evalio_series_archived(t.series_id)
    ORDER BY s.submitted_at DESC, s.id DESC
    LIMIT 4
  ) recent;

  RETURN jsonb_build_object(
    'stats', v_stats || v_attempts,
    'items', v_items,
    'total', v_filtered,
    'page', p_page,
    'pageSize', 10,
    'recentSubmissions', v_recent
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.evalio_respondent_dashboard(
  p_respondent_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_available_count BIGINT;
  v_completed_count BIGINT;
  v_attempt_count BIGINT;
  v_average NUMERIC;
  v_available JSONB;
  v_recent JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_respondent_id AND role = 'respondent'
  ) THEN
    RAISE EXCEPTION 'respondent_required';
  END IF;

  SELECT COUNT(*) INTO v_available_count
  FROM public.tests t
  WHERE t.status = 'published' AND t.is_current
    AND NOT public.evalio_series_archived(t.series_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.submissions s
      JOIN public.tests old_version ON old_version.id = s.test_id
      WHERE old_version.series_id = t.series_id
        AND s.respondent_id = p_respondent_id
    );

  SELECT COUNT(DISTINCT t.series_id), COUNT(*),
         ROUND(AVG(CASE WHEN t.show_result_immediately
           THEN 100.0 * s.score / NULLIF(s.max_score, 0)
           ELSE NULL END), 1)
  INTO v_completed_count, v_attempt_count, v_average
  FROM public.submissions s
  JOIN public.tests t ON t.id = s.test_id
  WHERE s.respondent_id = p_respondent_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'seriesId', t.series_id,
        'versionNumber', t.version_number,
        'isCurrent', t.is_current,
        'title', t.title,
        'description', t.description,
        'kind', t.kind,
        'questionCount', (
          SELECT COUNT(*) FROM public.questions q WHERE q.test_id = t.id
        )
      ) ORDER BY t.created_at DESC, t.id DESC
    ),
    '[]'::jsonb
  ) INTO v_available
  FROM (
    SELECT * FROM public.tests t
    WHERE t.status = 'published' AND t.is_current
      AND NOT public.evalio_series_archived(t.series_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.submissions s
        JOIN public.tests old_version ON old_version.id = s.test_id
        WHERE old_version.series_id = t.series_id
          AND s.respondent_id = p_respondent_id
      )
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT 6
  ) t;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', recent.id,
        'testId', recent.test_id,
        'testTitle', recent.title,
        'kind', recent.kind,
        'resultVisible', (recent.kind = 'test' AND recent.show_result_immediately),
        'score', CASE WHEN recent.show_result_immediately THEN recent.score ELSE NULL END,
        'maxScore', CASE WHEN recent.show_result_immediately THEN recent.max_score ELSE NULL END,
        'submittedAt', recent.submitted_at
      ) ORDER BY recent.submitted_at DESC, recent.id DESC
    ),
    '[]'::jsonb
  ) INTO v_recent
  FROM (
    SELECT s.id, s.test_id, s.score, s.max_score, s.submitted_at,
           t.title, t.kind, t.show_result_immediately
    FROM public.submissions s
    JOIN public.tests t ON t.id = s.test_id
    WHERE s.respondent_id = p_respondent_id
    ORDER BY s.submitted_at DESC, s.id DESC
    LIMIT 5
  ) recent;

  RETURN jsonb_build_object(
    'availableCount', v_available_count,
    'completedTests', v_completed_count,
    'totalAttempts', v_attempt_count,
    'averagePercent', v_average,
    'availableTests', v_available,
    'recentSubmissions', v_recent
  );
END;
$$;

-- RPCs must not be callable directly from browser clients.
REVOKE ALL ON FUNCTION public.evalio_creator_dashboard(UUID, INTEGER, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evalio_respondent_dashboard(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evalio_creator_dashboard(UUID, INTEGER, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.evalio_respondent_dashboard(UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';


COMMIT;
