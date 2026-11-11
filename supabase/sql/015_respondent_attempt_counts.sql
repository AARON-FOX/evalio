-- One exact aggregated count per logical test series. Used by student catalog.
-- Apply once AFTER 014_super_admin.sql.
BEGIN;
CREATE OR REPLACE FUNCTION public.evalio_respondent_attempt_counts(p_respondent_id uuid)
RETURNS TABLE(series_id uuid, used_attempts bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT t.series_id, count(*)::bigint
  FROM public.submissions s
  JOIN public.tests t ON t.id = s.test_id
  WHERE s.respondent_id = p_respondent_id
  GROUP BY t.series_id
$$;
REVOKE ALL ON FUNCTION public.evalio_respondent_attempt_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evalio_respondent_attempt_counts(uuid) TO service_role;
COMMIT;
