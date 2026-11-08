import { Router, type Response } from "express";
import { z } from "zod";

import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth, requireCreator } from "../middleware/requireAuth.js";
import { addQuestionSchema } from "../schemas/testSchemas.js";

export const questionEditorRouter = Router();
questionEditorRouter.use(requireAuth, requireCreator);

const uuid = z.string().uuid();

function reportDbError(res: Response, error: unknown) {
  console.error("Question editor database error:", error);
  res.status(502).json({ message: "Question editor request failed" });
}

// Map explicit SQL business exceptions to stable client statuses
function reportEditError(res: Response, error: { message: string }): boolean {
  const code = error.message;
  if (
    code.includes("draft_not_editable") ||
    code.includes("test_has_submissions")
  ) {
    res.status(409).json({ message: "Draft is not editable" });
    return true;
  }
  if (code.includes("question_not_found")) {
    res.status(404).json({ message: "Question not found" });
    return true;
  }
  if (
    [
      "invalid_question",
      "invalid_options",
      "invalid_options_count",
      "invalid_option",
      "invalid_correct_answers",
      "survey_has_correct_answers",
    ].some((name) => code.includes(name))
  ) {
    res.status(400).json({ message: code });
    return true;
  }
  return false;
}

// GET /api/tests/:id/editor
// Intentionally returns correct-answer indicators only to the draft OWNER
questionEditorRouter.get("/:id/editor", async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ message: "Invalid test ID" });
    return;
  }

  const { data: test, error: testError } = await supabaseAdmin
    .from("tests")
    .select("id, creator_id, title, description, kind, status, created_at")
    .eq("id", id.data)
    .eq("creator_id", req.authUser!.id)
    .eq("status", "draft")
    .maybeSingle();

  if (testError) {
    reportDbError(res, testError);
    return;
  }
  if (!test) {
    res.status(404).json({ message: "Editable draft not found" });
    return;
  }

  const { data: questions, error: questionsError } = await supabaseAdmin
    .from("questions")
    .select("id, text, question_type, position")
    .eq("test_id", test.id)
    .order("position", { ascending: true });
  if (questionsError) {
    reportDbError(res, questionsError);
    return;
  }

  const questionIds = (questions ?? []).map((question) => question.id);
  if (questionIds.length === 0) {
    res.json({ ...test, questions: [] });
    return;
  }

  const { data: options, error: optionsError } = await supabaseAdmin
    .from("options")
    .select("id, question_id, text, position")
    .in("question_id", questionIds)
    .order("position", { ascending: true });
  if (optionsError) {
    reportDbError(res, optionsError);
    return;
  }

  const optionIds = (options ?? []).map((option) => option.id);
  let correctIds = new Set<string>();
  if (optionIds.length > 0) {
    const { data: correct, error: correctError } = await supabaseAdmin
      .from("correct_options")
      .select("option_id")
      .in("option_id", optionIds);
    if (correctError) {
      reportDbError(res, correctError);
      return;
    }
    correctIds = new Set((correct ?? []).map((item) => item.option_id));
  }

  res.json({
    ...test,
    questions: (questions ?? []).map((question) => ({
      ...question,
      options: (options ?? [])
        .filter((option) => option.question_id === question.id)
        .map((option) => ({
          id: option.id,
          text: option.text,
          position: option.position,
          isCorrect: correctIds.has(option.id),
        })),
    })),
  });
});

// PATCH /api/tests/:id/questions/:questionId
questionEditorRouter.patch("/:id/questions/:questionId", async (req, res) => {
  const testId = uuid.safeParse(req.params.id);
  const questionId = uuid.safeParse(req.params.questionId);
  const input = addQuestionSchema.safeParse(req.body);
  if (!testId.success || !questionId.success || !input.success) {
    res.status(400).json({
      message: "Invalid question update",
      issues: input.success ? undefined : input.error.issues,
    });
    return;
  }

  const { data, error } = await supabaseAdmin.rpc("evalio_update_question", {
    p_test_id: testId.data,
    p_creator_id: req.authUser!.id,
    p_question_id: questionId.data,
    p_text: input.data.text,
    p_question_type: input.data.questionType,
    p_options: input.data.options,
  });

  if (error) {
    if (!reportEditError(res, error)) reportDbError(res, error);
    return;
  }
  res.json({ id: data, message: "Question updated" });
});

// DELETE /api/tests/:id/questions/:questionId
questionEditorRouter.delete("/:id/questions/:questionId", async (req, res) => {
  const testId = uuid.safeParse(req.params.id);
  const questionId = uuid.safeParse(req.params.questionId);
  if (!testId.success || !questionId.success) {
    res.status(400).json({ message: "Invalid identifier" });
    return;
  }

  const { error } = await supabaseAdmin.rpc("evalio_delete_question", {
    p_test_id: testId.data,
    p_creator_id: req.authUser!.id,
    p_question_id: questionId.data,
  });

  if (error) {
    if (!reportEditError(res, error)) reportDbError(res, error);
    return;
  }
  res.status(204).send();
});
