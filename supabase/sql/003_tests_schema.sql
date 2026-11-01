-- ==========================================
-- Evalio: Tests and Surveys Database Schema
-- ==========================================

-- 1. Tests and surveys
CREATE TABLE IF NOT EXISTS public.tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  creator_id UUID NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,

  title TEXT NOT NULL
    CHECK (length(btrim(title)) BETWEEN 1 AND 200),

  description TEXT,

  kind TEXT NOT NULL DEFAULT 'test'
    CHECK (kind IN ('test', 'survey')),

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Questions
CREATE TABLE IF NOT EXISTS public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  test_id UUID NOT NULL
    REFERENCES public.tests(id) ON DELETE CASCADE,

  text TEXT NOT NULL
    CHECK (length(btrim(text)) > 0),

  question_type TEXT NOT NULL
    CHECK (
      question_type IN ('single_choice', 'multiple_choice')
    ),

  position INTEGER NOT NULL CHECK (position > 0),

  UNIQUE (test_id, position)
);

-- 3. Answer options
CREATE TABLE IF NOT EXISTS public.options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  question_id UUID NOT NULL
    REFERENCES public.questions(id) ON DELETE CASCADE,

  text TEXT NOT NULL
    CHECK (length(btrim(text)) > 0),

  position INTEGER NOT NULL CHECK (position > 0),

  UNIQUE (question_id, position)
);

-- 4. Correct answers (server-only)
CREATE TABLE IF NOT EXISTS public.correct_options (
  option_id UUID PRIMARY KEY
    REFERENCES public.options(id) ON DELETE CASCADE
);

-- 5. Completed test submissions
CREATE TABLE IF NOT EXISTS public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  test_id UUID NOT NULL
    REFERENCES public.tests(id) ON DELETE CASCADE,

  respondent_id UUID NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,

  score INTEGER CHECK (score >= 0),

  max_score INTEGER CHECK (max_score >= 0),

  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (
    score IS NULL
    OR (
      max_score IS NOT NULL
      AND score <= max_score
    )
  )
);

-- 6. Selected options in a submission
CREATE TABLE IF NOT EXISTS public.submission_answers (
  submission_id UUID NOT NULL
    REFERENCES public.submissions(id) ON DELETE CASCADE,

  option_id UUID NOT NULL
    REFERENCES public.options(id) ON DELETE CASCADE,

  PRIMARY KEY (submission_id, option_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tests_creator
ON public.tests (creator_id);

CREATE INDEX IF NOT EXISTS idx_tests_status
ON public.tests (status);

CREATE INDEX IF NOT EXISTS idx_questions_test
ON public.questions (test_id);

CREATE INDEX IF NOT EXISTS idx_options_question
ON public.options (question_id);

CREATE INDEX IF NOT EXISTS idx_submissions_test
ON public.submissions (test_id);

CREATE INDEX IF NOT EXISTS idx_submissions_respondent
ON public.submissions (respondent_id);

CREATE INDEX IF NOT EXISTS idx_submission_answers_option
ON public.submission_answers (option_id);


-- ==========================================
-- Evalio: Access Control and RLS
-- ==========================================

-- Enable RLS on all new tables
ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.correct_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_answers ENABLE ROW LEVEL SECURITY;

-- Remove default client privileges
REVOKE ALL ON TABLE
  public.tests,
  public.questions,
  public.options,
  public.correct_options,
  public.submissions,
  public.submission_answers
FROM anon, authenticated;

-- Signed-in users can read permitted rows
GRANT SELECT ON TABLE
  public.tests,
  public.questions,
  public.options,
  public.submissions,
  public.submission_answers
TO authenticated;

-- Privileged backend operations
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.tests,
  public.questions,
  public.options,
  public.correct_options,
  public.submissions,
  public.submission_answers
TO service_role;

-- 1. Visible tests
CREATE POLICY "Read visible tests"
ON public.tests
FOR SELECT
TO authenticated
USING (
  status = 'published'
  OR creator_id = (SELECT auth.uid())
);

-- 2. Visible questions
CREATE POLICY "Read visible questions"
ON public.questions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tests t
    WHERE t.id = questions.test_id
      AND (
        t.status = 'published'
        OR t.creator_id = (SELECT auth.uid())
      )
  )
);

-- 3. Visible answer options
CREATE POLICY "Read visible options"
ON public.options
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.questions q
    JOIN public.tests t ON t.id = q.test_id
    WHERE q.id = options.question_id
      AND (
        t.status = 'published'
        OR t.creator_id = (SELECT auth.uid())
      )
  )
);

-- 4. Own results or results of own tests
CREATE POLICY "Read permitted submissions"
ON public.submissions
FOR SELECT
TO authenticated
USING (
  respondent_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.tests t
    WHERE t.id = submissions.test_id
      AND t.creator_id = (SELECT auth.uid())
  )
);

-- 5. Answers for permitted submissions
CREATE POLICY "Read permitted submission answers"
ON public.submission_answers
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.submissions s
    WHERE s.id = submission_answers.submission_id
      AND (
        s.respondent_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.tests t
          WHERE t.id = s.test_id
            AND t.creator_id = (SELECT auth.uid())
        )
      )
  )
);

-- No SELECT policy for correct_options.
-- No INSERT/UPDATE/DELETE grants for authenticated.
-- Correct answers are accessible only to trusted
-- privileged server-side operations.
