import { Router, type Response } from "express";
import { z } from "zod";
import { withSignedQuestionImages } from "../lib/testMedia.js";

import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth, requireRespondent } from "../middleware/requireAuth.js";

// Student-only, owner-only detailed results for the EXACT submitted version.
export const submissionResultRouter = Router();

submissionResultRouter.use(requireAuth, requireRespondent);

const uuid = z.string().uuid();

type AnswerOption = {
  id: string;
  text: string;
  position: number;
  image_path: string | null;
  image_only: boolean;
  imageUrl?: string | null;
  correct_options: { option_id: string }[] | { option_id: string } | null;
};

type StoredQuestion = {
  id: string;
  text: string;
  position: number;
  points: number;
  explanation: string | null;
  image_path: string | null;
  options: AnswerOption[];
};

function failDatabase(res: Response, error: unknown) {
  console.error("Submission result database error:", error);
  res.status(502).json({ message: "Не вдалося завантажити результат." });
}

function isKeyOption(option: AnswerOption) {
  const keys = option.correct_options;
  return Array.isArray(keys) ? keys.length > 0 : keys != null;
}

function elapsedSeconds(
  startedAt: string | null,
  finishedAt: string | null,
  expiresAt: string | null,
  reason: string | null,
): number | null {
  if (!startedAt || !finishedAt) return null;
  const start = Date.parse(startedAt);
  let end = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (reason === "timeout" && expiresAt) {
    const expiry = Date.parse(expiresAt);
    if (Number.isFinite(expiry)) end = Math.min(end, expiry);
  }
  return Math.max(0, Math.round((end - start) / 1000));
}

// GET /api/submissions/:submissionId/result
submissionResultRouter.get("/:submissionId/result", async (req, res) => {
  const id = uuid.safeParse(req.params.submissionId);
  if (!id.success) {
    res.status(400).json({ message: "Некоректний ідентифікатор результату." });
    return;
  }

  // FIRST authorize ownership. Never query or expose the answer key before this.
  const { data: submission, error: submissionError } = await supabaseAdmin
    .from("submissions")
    .select("id,test_id,score,max_score,submitted_at")
    .eq("id", id.data)
    .eq("respondent_id", req.authUser!.id)
    .maybeSingle();
  if (submissionError) {
    failDatabase(res, submissionError);
    return;
  }
  if (!submission) {
    res.status(404).json({ message: "Результат не знайдено." });
    return;
  }

  // Resolve the historical test version referenced by the submission, NOT
  // a current published version from the same series.
  const { data: test, error: testError } = await supabaseAdmin
    .from("tests")
    .select(
      "id,title,kind,subject,class_group,version_number,show_result_immediately,show_correct_answers",
    )
    .eq("id", submission.test_id)
    .maybeSingle();
  if (testError) {
    failDatabase(res, testError);
    return;
  }
  if (!test) {
    res.status(404).json({ message: "Версію тесту не знайдено." });
    return;
  }

  const resultVisible = test.kind === "test" && test.show_result_immediately;
  const reviewVisible = resultVisible && test.show_correct_answers;

  const { data: attempt, error: attemptError } = await supabaseAdmin
    .from("active_attempts")
    .select("started_at,finished_at,expires_at,finish_reason,question_order")
    .eq("submission_id", submission.id)
    .eq("respondent_id", req.authUser!.id)
    .maybeSingle();
  if (attemptError) {
    failDatabase(res, attemptError);
    return;
  }

  // When review is hidden, avoid reading answer keys or explanations at all.
  if (!reviewVisible) {
    const { count, error: countError } = await supabaseAdmin
      .from("questions")
      .select("id", { head: true, count: "exact" })
      .eq("test_id", test.id);
    if (countError) {
      failDatabase(res, countError);
      return;
    }
    res.json({
      id: submission.id,
      testId: test.id,
      testTitle: test.title,
      subject: test.subject,
      classGroup: test.class_group,
      versionNumber: test.version_number,
      kind: test.kind,
      submittedAt: submission.submitted_at,
      durationSeconds: elapsedSeconds(
        attempt?.started_at ?? null,
        attempt?.finished_at ?? null,
        attempt?.expires_at ?? null,
        attempt?.finish_reason ?? null,
      ),
      finishReason: attempt?.finish_reason ?? null,
      resultVisible,
      reviewVisible: false,
      score: resultVisible ? submission.score : null,
      maxScore: resultVisible ? submission.max_score : null,
      totalQuestions: count ?? 0,
      correctCount: null,
      incorrectCount: null,
      unansweredCount: null,
      questions: [],
    });
    return;
  }

  // All question content belongs to the historical version identified above.
  const { data: storedQuestions, error: questionsError } = await supabaseAdmin
    .from("questions")
    .select(
      "id,text,position,points,explanation,image_path,options(id,text,position,image_path,image_only,correct_options(option_id))",
    )
    .eq("test_id", test.id)
    .order("position", { ascending: true });
  if (questionsError) {
    failDatabase(res, questionsError);
    return;
  }
  const questions = (storedQuestions ?? []) as StoredQuestion[];
  let questionsWithImages;
  try {
    questionsWithImages = await withSignedQuestionImages(questions);
  } catch (error) {
    failDatabase(res, error);
    return;
  }
  const imageUrls = new Map(questionsWithImages.map((q) => [q.id, q]));

  // Each option in submission_answers belongs to the already authorized
  // submission. Read in pages to support large tests (up to 100*12 choices).
  const selectedIds = new Set<string>();
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data: answers, error: answersError } = await supabaseAdmin
      .from("submission_answers")
      .select("option_id")
      .eq("submission_id", submission.id)
      .order("option_id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (answersError) {
      failDatabase(res, answersError);
      return;
    }
    for (const answer of answers ?? []) selectedIds.add(answer.option_id);
    if ((answers ?? []).length < pageSize) break;
  }

  const order = new Map(
    ((attempt?.question_order ?? []) as string[]).map((questionId, i) => [
      questionId,
      i,
    ]),
  );
  const sortedQuestions = [...questions].sort(
    (a, b) =>
      (order.get(a.id) ?? a.position + 1000) -
      (order.get(b.id) ?? b.position + 1000),
  );

  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;

  const review = sortedQuestions.map((question) => {
    const options = [...(question.options ?? [])].sort(
      (a, b) => a.position - b.position,
    );
    const selected = options.filter((option) => selectedIds.has(option.id));
    const correct = options.filter(isKeyOption);
    const answered = selected.length > 0;
    const correctSelection =
      answered &&
      selected.length === correct.length &&
      selected.every((option) => isKeyOption(option));
    const status = !answered
      ? "unanswered"
      : correctSelection
        ? "correct"
        : "incorrect";
    if (status === "correct") correctCount += 1;
    else if (status === "incorrect") incorrectCount += 1;
    else unansweredCount += 1;

    return {
      id: question.id,
      text: question.text,
      status,
      points: question.points,
      earnedPoints: correctSelection ? question.points : 0,
      imageUrl: imageUrls.get(question.id)?.imageUrl ?? null,
      selectedOptions: selected.map(({ id, text, image_only }) => ({
        id,
        text,
        imageOnly: image_only,
        imageUrl:
          imageUrls.get(question.id)?.options?.find((o) => o.id === id)
            ?.imageUrl ?? null,
      })),
      correctOptions: correct.map(({ id, text, image_only }) => ({
        id,
        text,
        imageOnly: image_only,
        imageUrl:
          imageUrls.get(question.id)?.options?.find((o) => o.id === id)
            ?.imageUrl ?? null,
      })),
      explanation: question.explanation,
    };
  });

  res.json({
    id: submission.id,
    testId: test.id,
    testTitle: test.title,
    subject: test.subject,
    classGroup: test.class_group,
    versionNumber: test.version_number,
    kind: test.kind,
    submittedAt: submission.submitted_at,
    durationSeconds: elapsedSeconds(
      attempt?.started_at ?? null,
      attempt?.finished_at ?? null,
      attempt?.expires_at ?? null,
      attempt?.finish_reason ?? null,
    ),
    finishReason: attempt?.finish_reason ?? null,
    resultVisible: true,
    reviewVisible: true,
    score: submission.score,
    maxScore: submission.max_score,
    totalQuestions: questions.length,
    correctCount,
    incorrectCount,
    unansweredCount,
    questions: review,
  });
});
