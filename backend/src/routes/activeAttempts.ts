import { Router, type Response } from "express";
import { z } from "zod";

import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth, requireRespondent } from "../middleware/requireAuth.js";

export const activeAttemptsRouter = Router();
activeAttemptsRouter.use(requireAuth, requireRespondent);

const uuid = z.string().uuid();
const startSchema = z.strictObject({ testId: uuid });
const saveSchema = z.strictObject({
  questionId: uuid,
  optionIds: z.array(uuid).max(12),
});

type ApiError = { message: string };
type QuestionOption = { id: string; text: string; position: number };
type Question = {
  id: string;
  text: string;
  question_type: "single_choice" | "multiple_choice";
  position: number;
  points: number;
  options: QuestionOption[];
};

function dbError(res: Response, error: unknown) {
  console.error("Active attempt database error:", error);
  res.status(502).json({ message: "Database operation failed" });
}

function rpcError(res: Response, message: string) {
  const known: Record<string, { code: number; text: string }> = {
    respondent_required: { code: 403, text: "Потрібна роль студента." },
    test_not_available: { code: 404, text: "Тест недоступний." },
    attempt_not_found: { code: 404, text: "Спробу не знайдено." },
    test_archived: {
      code: 409,
      text: "Цей тест більше недоступний для проходження.",
    },
    test_deadline_passed: { code: 409, text: "Дедлайн тесту минув." },
    attempt_limit_reached: { code: 409, text: "Ліміт спроб вичерпано." },
    attempt_finished: { code: 409, text: "Цю спробу вже завершено." },
    attempt_time_expired: { code: 409, text: "Час спроби завершився." },
    question_not_in_test: {
      code: 400,
      text: "Питання не належить цьому тесту.",
    },
    invalid_option_selection: {
      code: 400,
      text: "Некоректний вибір відповіді.",
    },
    invalid_option_id: {
      code: 400,
      text: "Некоректний ідентифікатор відповіді.",
    },
    test_has_invalid_questions: {
      code: 409,
      text: "Тест не містить коректних питань.",
    },
  };
  for (const [key, value] of Object.entries(known)) {
    if (message.includes(key)) {
      res.status(value.code).json({
        message: value.text,
        code: key,
      } satisfies ApiError & {
        code: string;
      });
      return;
    }
  }
  console.error("Unexpected attempt RPC error:", message);
  res.status(502).json({ message: "Database operation failed" });
}

async function fetchMaskedResult(
  attempt: {
    submission_id: string | null;
    finish_reason: string | null;
  },
  test: { kind: string; show_result_immediately: boolean },
) {
  if (!attempt.submission_id) return null;
  const { data, error } = await supabaseAdmin
    .from("submissions")
    .select("id, test_id, score, max_score, submitted_at")
    .eq("id", attempt.submission_id)
    .single();
  if (error || !data) throw new Error("submission_lookup_failed");
  const visible = test.kind === "test" && test.show_result_immediately;
  return {
    id: data.id,
    testId: data.test_id,
    kind: test.kind,
    resultVisible: visible,
    score: visible ? data.score : null,
    maxScore: visible ? data.max_score : null,
    submittedAt: data.submitted_at,
    reason: attempt.finish_reason,
  };
}

// POST /api/attempts/start  { testId }
// Resumes existing active attempt for the same series; never resets its clock.
activeAttemptsRouter.post("/start", async (req, res) => {
  const input = startSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ message: "Invalid test ID" });
    return;
  }

  const { data, error } = await supabaseAdmin.rpc(
    "evalio_start_active_attempt",
    {
      p_test_id: input.data.testId,
      p_respondent_id: req.authUser!.id,
    },
  );
  if (error) {
    rpcError(res, error.message);
    return;
  }
  res.status(201).json(data);
});

// GET /api/attempts/:id
// Returns answer selections and safe test metadata ONLY to the owner.
activeAttemptsRouter.get("/:id", async (req, res) => {
  const attemptId = uuid.safeParse(req.params.id);
  if (!attemptId.success) {
    res.status(400).json({ message: "Invalid attempt ID" });
    return;
  }

  async function readAttempt() {
    return supabaseAdmin
      .from("active_attempts")
      .select(
        "id, test_id, started_at, expires_at, answers, question_order, status, submission_id, finish_reason",
      )
      .eq("id", attemptId.data)
      .eq("respondent_id", req.authUser!.id)
      .maybeSingle();
  }
  let { data: attempt, error } = await readAttempt();
  if (error) {
    dbError(res, error);
    return;
  }
  if (!attempt) {
    res.status(404).json({ message: "Attempt not found" });
    return;
  }

  // Lazy expiry: even if the browser was closed when the timer elapsed,
  // the next read creates the authoritative submission exactly once.
  if (
    attempt.status === "active" &&
    attempt.expires_at &&
    Date.parse(attempt.expires_at) <= Date.now()
  ) {
    const finished = await supabaseAdmin.rpc("evalio_finish_active_attempt", {
      p_attempt_id: attemptId.data,
      p_respondent_id: req.authUser!.id,
    });
    if (finished.error) {
      rpcError(res, finished.error.message);
      return;
    }
    ({ data: attempt, error } = await readAttempt());
    if (error) {
      dbError(res, error);
      return;
    }
    if (!attempt) {
      res.status(404).json({ message: "Attempt not found" });
      return;
    }
  }

  const { data: test, error: testError } = await supabaseAdmin
    .from("tests")
    .select(
      "id,title,description,kind,subject,class_group,duration_minutes,show_result_immediately",
    )
    .eq("id", attempt.test_id)
    .single();
  if (testError || !test) {
    dbError(res, testError);
    return;
  }

  if (attempt.status === "submitted") {
    try {
      const result = await fetchMaskedResult(attempt, test);
      res.json({
        id: attempt.id,
        status: "submitted",
        testId: test.id,
        title: test.title,
        result,
      });
    } catch (e) {
      dbError(res, e);
    }
    return;
  }

  const { data: questions, error: questionsError } = await supabaseAdmin
    .from("questions")
    .select("id,text,question_type,position,points,options(id,text,position)")
    .eq("test_id", test.id);
  if (questionsError) {
    dbError(res, questionsError);
    return;
  }

  const order: string[] = attempt.question_order ?? [];
  const orderMap = new Map(order.map((id, index) => [id, index]));
  const safeQuestions = ((questions ?? []) as Question[])
    .map((q) => ({
      id: q.id,
      text: q.text,
      questionType: q.question_type,
      points: q.points,
      options: [...q.options]
        .sort((a, b) => a.position - b.position)
        .map(({ id, text }) => ({ id, text })),
    }))
    .sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));

  res.json({
    id: attempt.id,
    status: "active",
    testId: test.id,
    title: test.title,
    description: test.description,
    subject: test.subject,
    classGroup: test.class_group,
    kind: test.kind,
    startedAt: attempt.started_at,
    expiresAt: attempt.expires_at,
    serverNow: new Date().toISOString(),
    answers: attempt.answers,
    questions: safeQuestions,
  });
});

// PUT /api/attempts/:id/answer { questionId, optionIds }
activeAttemptsRouter.put("/:id/answer", async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  const input = saveSchema.safeParse(req.body);
  if (!id.success || !input.success) {
    res.status(400).json({ message: "Invalid answer" });
    return;
  }
  const { data, error } = await supabaseAdmin.rpc("evalio_save_active_answer", {
    p_attempt_id: id.data,
    p_respondent_id: req.authUser!.id,
    p_question_id: input.data.questionId,
    p_option_ids: input.data.optionIds,
  });
  if (error) {
    rpcError(res, error.message);
    return;
  }
  res.json(data);
});

// POST /api/attempts/:id/finish
// Idempotent; handles answered, unanswered and timed-out questions.
activeAttemptsRouter.post("/:id/finish", async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ message: "Invalid attempt ID" });
    return;
  }
  const { data, error } = await supabaseAdmin.rpc(
    "evalio_finish_active_attempt",
    {
      p_attempt_id: id.data,
      p_respondent_id: req.authUser!.id,
    },
  );
  if (error) {
    rpcError(res, error.message);
    return;
  }
  res.json(data);
});
