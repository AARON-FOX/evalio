-- Evalio 011: version-aware dashboards and grade visibility for direct clients.
-- Requires 009 and 010. Supabase admin/SQL Editor accesses trusted original rows.
BEGIN;

-- Explanations can reveal answer keys and must not be accessible from
-- the browser even though question text and points are publicly readable.
REVOKE SELECT ON public.questions FROM authenticated;
GRANT SELECT (id, test_id, text, question_type, position, points)
  ON public.questions TO authenticated;

-- Block direct authenticated SELECT of score/max_score even if RLS would
-- allow reading a submission. Those fields are returned only by trusted
-- Express endpoints, with the test's result visibility policy enforced.
REVOKE SELECT ON public.submissions FROM authenticated;
GRANT SELECT (id, test_id, respondent_id, submitted_at)
  ON public.submissions TO authenticated;

-- Version-aware dashboard aggregates; functions retain the same signatures.
-- Existing profiles roles: creator/respondent.

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
  FROM public.tests
  WHERE creator_id = p_creator_id;

  SELECT jsonb_build_object(
    'totalAttempts', COUNT(*),
    'averagePercent', ROUND(AVG(100.0 * s.score / NULLIF(s.max_score, 0)), 1)
  ) INTO v_attempts
  FROM public.submissions s
  JOIN public.tests t ON t.id = s.test_id
  WHERE t.creator_id = p_creator_id;

  SELECT COUNT(*) INTO v_filtered
  FROM public.tests t
  WHERE t.creator_id = p_creator_id
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
