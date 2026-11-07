CREATE OR REPLACE FUNCTION public.evalio_test_statistics(
  p_test_id UUID,
  p_creator_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_test RECORD;
  v_result JSONB;
BEGIN
  -- Verify that the test belongs to this creator.
  SELECT id, title, kind, status
  INTO v_test
  FROM public.tests
  WHERE id = p_test_id
    AND creator_id = p_creator_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'test_not_owned';
  END IF;

  SELECT jsonb_build_object(
    'testId', v_test.id,
    'title', v_test.title,
    'kind', v_test.kind,
    'status', v_test.status,

    'totalAttempts', (
      SELECT COUNT(*)
      FROM public.submissions s
      WHERE s.test_id = p_test_id
    ),

    'uniqueRespondents', (
      SELECT COUNT(DISTINCT s.respondent_id)
      FROM public.submissions s
      WHERE s.test_id = p_test_id
    ),

    'averageScore', (
      SELECT ROUND(AVG(s.score), 2)
      FROM public.submissions s
      WHERE s.test_id = p_test_id
        AND s.score IS NOT NULL
    ),

    'averagePercent', (
      SELECT ROUND(
        AVG(
          100.0 * s.score /
          NULLIF(s.max_score, 0)
        ),
        1
      )
      FROM public.submissions s
      WHERE s.test_id = p_test_id
        AND s.score IS NOT NULL
    ),

    'recentSubmissions', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', recent.id,
            'respondentId', recent.respondent_id,
            'score', recent.score,
            'maxScore', recent.max_score,
            'submittedAt', recent.submitted_at
          )
          ORDER BY recent.submitted_at DESC, recent.id DESC
        )
        FROM (
          SELECT
            id,
            respondent_id,
            score,
            max_score,
            submitted_at
          FROM public.submissions
          WHERE test_id = p_test_id
          ORDER BY submitted_at DESC, id DESC
          LIMIT 20
        ) recent
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.evalio_submission_details(
  p_test_id UUID,
  p_creator_id UUID,
  p_submission_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_test RECORD;
  v_submission RECORD;
BEGIN
  -- Confirm test ownership.
  SELECT id, kind
  INTO v_test
  FROM public.tests
  WHERE id = p_test_id
    AND creator_id = p_creator_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'test_not_owned';
  END IF;

  -- Confirm that the submission belongs to this test.
  SELECT
    id,
    respondent_id,
    score,
    max_score,
    submitted_at
  INTO v_submission
  FROM public.submissions
  WHERE id = p_submission_id
    AND test_id = p_test_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'submission_not_found';
  END IF;

  RETURN jsonb_build_object(
    'id', v_submission.id,
    'respondentId', v_submission.respondent_id,
    'score', v_submission.score,
    'maxScore', v_submission.max_score,
    'submittedAt', v_submission.submitted_at,

    'questions', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'questionId', q.id,
            'text', q.text,
            'questionType', q.question_type,

            'selectedOptions', COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', o.id,
                    'text', o.text
                  )
                  ORDER BY o.position
                )
                FROM public.submission_answers sa
                JOIN public.options o
                  ON o.id = sa.option_id
                WHERE sa.submission_id = v_submission.id
                  AND o.question_id = q.id
              ),
              '[]'::jsonb
            ),

            'isCorrect',
              CASE
                WHEN v_test.kind = 'survey' THEN NULL
                ELSE (
                  COALESCE(
                    (
                      SELECT array_agg(
                        sa.option_id ORDER BY sa.option_id
                      )
                      FROM public.submission_answers sa
                      JOIN public.options o
                        ON o.id = sa.option_id
                      WHERE sa.submission_id = v_submission.id
                        AND o.question_id = q.id
                    ),
                    ARRAY[]::UUID[]
                  )
                  =
                  COALESCE(
                    (
                      SELECT array_agg(
                        co.option_id ORDER BY co.option_id
                      )
                      FROM public.correct_options co
                      JOIN public.options o
                        ON o.id = co.option_id
                      WHERE o.question_id = q.id
                    ),
                    ARRAY[]::UUID[]
                  )
                )
              END
          )
          ORDER BY q.position
        )
        FROM public.questions q
        WHERE q.test_id = p_test_id
      ),
      '[]'::jsonb
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evalio_test_statistics(
  UUID, UUID
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.evalio_submission_details(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.evalio_test_statistics(
  UUID, UUID
) TO service_role;

GRANT EXECUTE ON FUNCTION public.evalio_submission_details(
  UUID, UUID, UUID
) TO service_role;

NOTIFY pgrst, 'reload schema';
