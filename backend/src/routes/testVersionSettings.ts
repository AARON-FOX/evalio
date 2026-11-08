import { Router, type Response } from "express";
import { z } from "zod";

import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth, requireCreator } from "../middleware/requireAuth.js";

export const testVersionSettingsRouter = Router();
testVersionSettingsRouter.use(requireAuth, requireCreator);

const uuid = z.string().uuid();

const settingsSchema = z
  .strictObject({
    subject: z.string().trim().max(120).nullable().optional(),
    classGroup: z.string().trim().max(80).nullable().optional(),
    durationMinutes: z.number().int().min(1).max(180).nullable().optional(),
    maxAttempts: z.number().int().min(1).max(20).nullable().optional(),
    availableUntil: z.string().datetime({ offset: true }).nullable().optional(),
    showResultImmediately: z.boolean().optional(),
    showCorrectAnswers: z.boolean().optional(),
    shuffleQuestions: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting must be specified",
  });

const fields = [
  "id",
  "series_id",
  "version_number",
  "is_current",
  "creator_id",
  "title",
  "description",
  "kind",
  "status",
  "subject",
  "class_group",
  "duration_minutes",
  "max_attempts",
  "available_until",
  "show_result_immediately",
  "show_correct_answers",
  "shuffle_questions",
  "created_at",
].join(", ");

function dbError(res: Response, error: unknown) {
  console.error("Version/settings database error:", error);
  res.status(502).json({ message: "Database operation failed" });
}

// POST /api/tests/:id/revisions
// Clones an existing CURRENT published version into a separate draft.
testVersionSettingsRouter.post("/:id/revisions", async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ message: "Invalid test ID" });
    return;
  }

  const { data, error } = await supabaseAdmin.rpc(
    "evalio_create_draft_revision",
    {
      p_test_id: id.data,
      p_creator_id: req.authUser!.id,
    },
  );
  if (error) {
    if (error.message.includes("current_published_test_not_found")) {
      res.status(404).json({ message: "Current published test not found" });
      return;
    }
    dbError(res, error);
    return;
  }

  res.status(201).json({ draftId: data });
});

// GET /api/tests/:id/versions
// Return the version history to the test owner only.
testVersionSettingsRouter.get("/:id/versions", async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ message: "Invalid test ID" });
    return;
  }

  const { data: source, error: sourceError } = await supabaseAdmin
    .from("tests")
    .select("series_id")
    .eq("id", id.data)
    .eq("creator_id", req.authUser!.id)
    .maybeSingle();
  if (sourceError) {
    dbError(res, sourceError);
    return;
  }
  if (!source) {
    res.status(404).json({ message: "Test not found" });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("tests")
    .select(
      "id, series_id, version_number, status, is_current, title, created_at",
    )
    .eq("series_id", source.series_id)
    .eq("creator_id", req.authUser!.id)
    .order("version_number", { ascending: false });
  if (error) {
    dbError(res, error);
    return;
  }

  res.json(data ?? []);
});

// GET /api/tests/:id/settings
// Settings are available for the owner of any version.
testVersionSettingsRouter.get("/:id/settings", async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ message: "Invalid test ID" });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("tests")
    .select(fields)
    .eq("id", id.data)
    .eq("creator_id", req.authUser!.id)
    .maybeSingle();
  if (error) {
    dbError(res, error);
    return;
  }
  if (!data) {
    res.status(404).json({ message: "Test not found" });
    return;
  }

  res.json(data);
});

// PATCH /api/tests/:id/settings
// Metadata of a draft is editable; published version remains frozen.
testVersionSettingsRouter.patch("/:id/settings", async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  const parsed = settingsSchema.safeParse(req.body);
  if (!id.success || !parsed.success) {
    res.status(400).json({
      message: "Invalid settings",
      issues: parsed.success ? undefined : parsed.error.issues,
    });
    return;
  }

  const d = parsed.data;
  const update: Record<string, unknown> = {};
  if (d.subject !== undefined) update.subject = d.subject;
  if (d.classGroup !== undefined) update.class_group = d.classGroup;
  if (d.durationMinutes !== undefined)
    update.duration_minutes = d.durationMinutes;
  if (d.maxAttempts !== undefined) update.max_attempts = d.maxAttempts;
  if (d.availableUntil !== undefined) update.available_until = d.availableUntil;
  if (d.showResultImmediately !== undefined)
    update.show_result_immediately = d.showResultImmediately;
  if (d.showCorrectAnswers !== undefined)
    update.show_correct_answers = d.showCorrectAnswers;
  if (d.shuffleQuestions !== undefined)
    update.shuffle_questions = d.shuffleQuestions;

  const { data, error } = await supabaseAdmin
    .from("tests")
    .update(update)
    .eq("id", id.data)
    .eq("creator_id", req.authUser!.id)
    .eq("status", "draft")
    .select(fields)
    .maybeSingle();
  if (error) {
    dbError(res, error);
    return;
  }
  if (!data) {
    res.status(409).json({ message: "Draft not editable or not owned by you" });
    return;
  }

  res.json(data);
});
