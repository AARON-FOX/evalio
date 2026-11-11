import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth, requireRespondent } from "../middleware/requireAuth.js";

export const testOverviewRouter = Router();

const idSchema = z.string().uuid();

// Safe pre-start metadata. Never return correct answers, answer explanations,
// private teacher settings, or other students' attempts.
testOverviewRouter.get("/:id/overview", requireAuth, requireRespondent, async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id);

  if (!parsed.success) {
    res.status(400).json({ message: "Invalid test ID" });
    return;
  }

  const userId = req.authUser!.id;
  const { data: test, error: testError } = await supabaseAdmin
    .from("tests")
    .select(
      "id,series_id,version_number,title,description,kind,subject,class_group,duration_minutes,max_attempts,available_until,created_at",
    )
    .eq("id", parsed.data)
    .eq("status", "published")
    .eq("is_current", true)
    .maybeSingle();
  if (testError) {
    console.error("Overview lookup error", testError);
    res.status(502).json({ message: "Could not load test" });
    return;
  }
  if (!test) {
    res.status(404).json({ message: "Test not found" });
    return;
  }

  const { data: versions, error: versionsError } = await supabaseAdmin
    .from("tests")
    .select("id")
    .eq("series_id", test.series_id);
  const { data: questionRows, error: questionsError } = await supabaseAdmin
    .from("questions")
    .select("points")
    .eq("test_id", test.id)
    .limit(101);
  if (versionsError || questionsError || !versions) {
    console.error("Overview metadata error", versionsError ?? questionsError);
    res.status(502).json({ message: "Could not load test availability" });
    return;
  }
  const questionCount = questionRows?.length ?? 0;
  const maxPoints =
    test.kind === "test"
      ? (questionRows ?? []).reduce((sum, row) => sum + (row.points ?? 1), 0)
      : null;
  const versionIds = versions.map((v) => v.id);
  const { count: completed, error: completedError } = await supabaseAdmin
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("respondent_id", userId)
    .in("test_id", versionIds);
  const { data: ongoing, error: ongoingError } = await supabaseAdmin
    .from("active_attempts")
    .select("id,expires_at")
    .eq("respondent_id", userId)
    .eq("series_id", test.series_id)
    .eq("status", "active")
    .maybeSingle();
  if (completedError || ongoingError) {
    console.error(
      "Overview attempt counter error",
      completedError ?? ongoingError,
    );
    res.status(502).json({ message: "Could not load attempt status" });
    return;
  }

  const usedAttempts = completed ?? 0;
  const remainingAttempts =
    test.max_attempts == null
      ? null
      : Math.max(0, test.max_attempts - usedAttempts);
  const deadlinePassed =
    !!test.available_until && Date.parse(test.available_until) <= Date.now();
  // Existing active attempts are resumable; DB controls the final outcome.
  const canStart =
    !!ongoing ||
    ((remainingAttempts === null || remainingAttempts > 0) &&
      !deadlinePassed &&
      (questionCount ?? 0) > 0);
  res.json({
    id: test.id,
    title: test.title,
    description: test.description,
    kind: test.kind,
    subject: test.subject,
    classGroup: test.class_group,
    versionNumber: test.version_number,
    durationMinutes: test.duration_minutes,
    maxAttempts: test.max_attempts,
    availableUntil: test.available_until,
    questionCount,
    maxPoints,
    usedAttempts,
    remainingAttempts,
    hasActiveAttempt: !!ongoing,
    activeAttemptExpiresAt: ongoing?.expires_at ?? null,
    deadlinePassed,
    canStart,
  });
});
