import { Router, type Response } from "express";
import { z } from "zod";

import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import {
  requireAuth,
  requireCreator,
  requireRespondent,
} from "../middleware/requireAuth.js";
import { submitTestSchema } from "../schemas/submissionSchemas.js";

import {
  createTestSchema,
  updateTestSchema,
  addQuestionSchema,
} from "../schemas/testSchemas.js";

export const testsRouter = Router();

const uuidSchema = z.string().uuid();

const testFields =
  "id, creator_id, title, description, kind, status, created_at, is_current, series_id, version_number, subject, class_group, duration_minutes, max_attempts, available_until";

function databaseError(res: Response, error: unknown) {
  console.error("Database error:", error);

  res.status(502).json({
    message: "Database operation failed",
  });
}

// Every tests route requires authentication.
testsRouter.use(requireAuth);

// ===========================================
// POST /api/tests
// Create a new draft
// ===========================================

testsRouter.post("/", requireCreator, async (req, res) => {
  const parsed = createTestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      message: "Invalid test data",
      issues: parsed.error.issues,
    });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("tests")
    .insert({
      creator_id: req.authUser!.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      kind: parsed.data.kind,
      status: "draft",
    })
    .select(testFields)
    .single();

  if (error) {
    databaseError(res, error);
    return;
  }

  res.status(201).json(data);
});

// ===========================================
// GET /api/tests
// Published tests and own drafts
// ===========================================

testsRouter.get("/", async (req, res) => {
  const userId = req.authUser!.id;

  const { data, error } = await supabaseAdmin
    .from("evalio_unarchived_tests")
    .select(testFields)
    .or(
      `and(status.eq.published,is_current.eq.true),and(status.eq.draft,creator_id.eq.${userId})`,
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    databaseError(res, error);
    return;
  }

  if (req.authUser!.role === "respondent") {
    const [countsResult, activeResult] = await Promise.all([
      supabaseAdmin.rpc("evalio_respondent_attempt_counts", {
        p_respondent_id: userId,
      }),
      supabaseAdmin
        .from("active_attempts")
        .select("series_id")
        .eq("respondent_id", userId)
        .eq("status", "active"),
    ]);
    if (countsResult.error || activeResult.error) {
      databaseError(res, countsResult.error ?? activeResult.error);
      return;
    }
    const counts = new Map<string, number>(
      (countsResult.data ?? []).map(
        (row: { series_id: string; used_attempts: number }) => [
          row.series_id,
          Number(row.used_attempts),
        ],
      ),
    );
    const activeSeries = new Set(
      (activeResult.data ?? []).map((row) => row.series_id),
    );
    res.json(
      (data ?? []).map((test) => {
        const usedAttempts = counts.get(test.series_id) ?? 0;
        return {
          ...test,
          usedAttempts,
          remainingAttempts:
            test.max_attempts == null
              ? null
              : Math.max(0, test.max_attempts - usedAttempts),
          hasActiveAttempt: activeSeries.has(test.series_id),
        };
      }),
    );
    return;
  }
  res.json(data ?? []);
});

// ===========================================
// GET /api/tests/:id
// Test details without correct answers
// ===========================================

testsRouter.get("/:id", async (req, res) => {
  const idResult = uuidSchema.safeParse(req.params.id);

  if (!idResult.success) {
    res.status(400).json({ message: "Invalid test ID" });
    return;
  }

  const { data: test, error: testError } = await supabaseAdmin
    .from("tests")
    .select(testFields)
    .eq("id", idResult.data)
    .maybeSingle();

  if (testError) {
    databaseError(res, testError);
    return;
  }

  if (
    !test ||
    (test.creator_id !== req.authUser!.id &&
      !(test.status === "published" && test.is_current))
  ) {
    res.status(404).json({
      message: "Test not found",
    });
    return;
  }

  const { data: questions, error: questionsError } = await supabaseAdmin
    .from("questions")
    .select(
      `
        id,
        text,
        question_type,
        position,
        options (
          id,
          text,
          position
        )
      `,
    )
    .eq("test_id", test.id)
    .order("position", { ascending: true });

  if (questionsError) {
    databaseError(res, questionsError);
    return;
  }

  const orderedQuestions = (questions ?? []).map((question) => ({
    ...question,
    options: [...question.options].sort((a, b) => a.position - b.position),
  }));

  res.json({
    ...test,
    questions: orderedQuestions,
  });
});

// ===========================================
// PATCH /api/tests/:id
// Edit own draft metadata
// ===========================================

testsRouter.patch("/:id", requireCreator, async (req, res) => {
  const idResult = uuidSchema.safeParse(req.params.id);
  const parsed = updateTestSchema.safeParse(req.body);

  if (!idResult.success || !parsed.success) {
    res.status(400).json({
      message: "Invalid request",
    });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("tests")
    .update(parsed.data)
    .eq("id", idResult.data)
    .eq("creator_id", req.authUser!.id)
    .eq("status", "draft")
    .select(testFields)
    .maybeSingle();

  if (error) {
    databaseError(res, error);
    return;
  }

  if (!data) {
    res.status(404).json({
      message: "Editable draft not found",
    });
    return;
  }

  res.json(data);
});

// ===========================================
// POST /api/tests/:id/questions
// Add a complete question atomically
// ===========================================

testsRouter.post("/:id/questions", requireCreator, async (req, res) => {
  const idResult = uuidSchema.safeParse(req.params.id);
  const parsed = addQuestionSchema.safeParse(req.body);

  if (!idResult.success || !parsed.success) {
    res.status(400).json({
      message: "Invalid question data",
      issues: parsed.success ? undefined : parsed.error.issues,
    });
    return;
  }

  const { data, error } = await supabaseAdmin.rpc("evalio_add_question_v2", {
    p_test_id: idResult.data,
    p_creator_id: req.authUser!.id,
    p_text: parsed.data.text,
    p_question_type: parsed.data.questionType,
    p_options: parsed.data.options,
    p_points: parsed.data.points,
    p_explanation: parsed.data.explanation,
  });

  if (error) {
    if (error.message === "test_not_editable") {
      res.status(409).json({
        message: "Draft is not editable or not owned by you",
      });
      return;
    }

    if (
      [
        "invalid_question",
        "invalid_question_metadata",
        "invalid_options",
        "invalid_options_count",
        "invalid_correct_answers",
        "survey_has_correct_answers",
        "invalid_option",
      ].includes(error.message)
    ) {
      res.status(400).json({
        message: error.message,
      });
      return;
    }

    databaseError(res, error);
    return;
  }

  res.status(201).json({
    id: data,
    message: "Question created",
  });
});

// ===========================================
// POST /api/tests/:id/publish
// Validate and publish own test
// ===========================================

testsRouter.post("/:id/publish", requireCreator, async (req, res) => {
  const idResult = uuidSchema.safeParse(req.params.id);

  if (!idResult.success) {
    res.status(400).json({
      message: "Invalid test ID",
    });
    return;
  }

  const { error } = await supabaseAdmin.rpc("evalio_publish_test", {
    p_test_id: idResult.data,
    p_creator_id: req.authUser!.id,
  });

  if (error) {
    if (error.message === "test_not_found") {
      res.status(404).json({
        message: "Test not found",
      });
      return;
    }

    if (
      [
        "test_already_published",
        "test_has_no_questions",
        "test_has_invalid_questions",
        "draft_not_editable",
        "invalid_questions_count",
      ].includes(error.message)
    ) {
      res.status(409).json({
        message: error.message,
      });
      return;
    }

    databaseError(res, error);
    return;
  }

  res.json({
    id: idResult.data,
    status: "published",
    message: "Test published successfully",
  });
});

// ===========================================
// POST /api/tests/:id/submissions
// ===========================================
testsRouter.post("/:id/submissions", requireRespondent, async (req, res) => {
  const idResult = uuidSchema.safeParse(req.params.id);
  const parsed = submitTestSchema.safeParse(req.body);

  if (!idResult.success || !parsed.success) {
    res.status(400).json({
      message: "Invalid submission data",
      issues: parsed.success ? undefined : parsed.error.issues,
    });
    return;
  }

  const { data, error } = await supabaseAdmin.rpc("evalio_submit_test", {
    p_test_id: idResult.data,
    p_respondent_id: req.authUser!.id,
    p_answers: parsed.data.answers,
  });

  if (error) {
    const message = error.message;

    if (message.includes("test_not_published")) {
      res.status(404).json({
        message: "Published test not found",
      });
      return;
    }

    if (message.includes("respondent_required")) {
      res.status(403).json({
        message: "Respondent role required",
      });
      return;
    }

    if (
      ["attempt_limit_reached", "test_deadline_passed"].some((code) =>
        message.includes(code),
      )
    ) {
      res.status(409).json({
        message,
      });
      return;
    }

    if (
      [
        "invalid_answers",
        "invalid_answers_count",
        "invalid_answer_format",
        "invalid_question_id",
        "duplicate_question",
        "question_not_in_test",
        "invalid_option_selection",
        "invalid_option_id",
      ].some((code) => message.includes(code))
    ) {
      res.status(400).json({
        message,
      });
      return;
    }

    console.error("Submission error:", error);

    res.status(502).json({
      message: "Could not save test submission",
    });
    return;
  }

  res.status(201).json(data);
});
