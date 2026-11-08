import { Router } from "express";

import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth, requireRespondent } from "../middleware/requireAuth.js";

export const submissionsRouter = Router();
submissionsRouter.use(requireAuth, requireRespondent);

// GET /api/submissions/mine
// The server masks scores for tests configured to hide immediate results.
submissionsRouter.get("/mine", async (req, res) => {
  const { data: submissions, error } = await supabaseAdmin
    .from("submissions")
    .select("id, test_id, score, max_score, submitted_at")
    .eq("respondent_id", req.authUser!.id)
    .order("submitted_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("Submissions error:", error);
    res.status(502).json({ message: "Could not load submissions" });
    return;
  }

  const testIds = [...new Set((submissions ?? []).map((item) => item.test_id))];
  if (testIds.length === 0) {
    res.json([]);
    return;
  }

  const { data: tests, error: testsError } = await supabaseAdmin
    .from("tests")
    .select("id, kind, show_result_immediately")
    .in("id", testIds);
  if (testsError) {
    console.error("Submission visibility error:", testsError);
    res.status(502).json({ message: "Could not load submissions" });
    return;
  }

  const visible = new Map(
    (tests ?? []).map((test) => [
      test.id,
      {
        kind: test.kind,
        visible: test.kind === "test" && test.show_result_immediately,
      },
    ]),
  );

  res.json(
    (submissions ?? []).map((s) => ({
      ...s,
      score: visible.get(s.test_id)?.visible ? s.score : null,
      max_score: visible.get(s.test_id)?.visible ? s.max_score : null,
      kind: visible.get(s.test_id)?.kind ?? null,
      result_visible: visible.get(s.test_id)?.visible ?? false,
    })),
  );
});
