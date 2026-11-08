-- Evalio dashboard aggregates. Trusted Express-only RPCs.
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
    'totalTests', COUNT(*),
    'publishedTests', COUNT(*) FILTER (WHERE status = 'published'),
    'draftTests', COUNT(*) FILTER (WHERE status = 'draft')
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
    AND (p_status = 'all' OR t.status = p_status)
    AND (BTRIM(p_search) = '' OR t.title ILIKE '%' || BTRIM(p_search) || '%');

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
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
      AND (p_status = 'all' OR t.status = p_status)
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
  WHERE t.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM public.submissions s
      WHERE s.test_id = t.id AND s.respondent_id = p_respondent_id
    );

  SELECT COUNT(DISTINCT test_id), COUNT(*),
         ROUND(AVG(100.0 * score / NULLIF(max_score, 0)), 1)
  INTO v_completed_count, v_attempt_count, v_average
  FROM public.submissions
  WHERE respondent_id = p_respondent_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
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
    WHERE t.status = 'published'
      AND NOT EXISTS (
        SELECT 1 FROM public.submissions s
        WHERE s.test_id = t.id AND s.respondent_id = p_respondent_id
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
        'score', recent.score,
        'maxScore', recent.max_score,
        'submittedAt', recent.submitted_at
      ) ORDER BY recent.submitted_at DESC, recent.id DESC
    ),
    '[]'::jsonb
  ) INTO v_recent
  FROM (
    SELECT s.id, s.test_id, s.score, s.max_score, s.submitted_at, t.title
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
