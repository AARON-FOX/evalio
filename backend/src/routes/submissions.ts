import { Router } from "express";

import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth, requireRespondent } from "../middleware/requireAuth.js";

export const submissionsRouter = Router();

submissionsRouter.use(requireAuth);
submissionsRouter.use(requireRespondent);

submissionsRouter.get("/mine", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("submissions")
    .select(
      `
      id,
      test_id,
      score,
      max_score,
      submitted_at
    `,
    )
    .eq("respondent_id", req.authUser!.id)
    .order("submitted_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Submissions error:", error);

    res.status(502).json({
      message: "Could not load submissions",
    });
    return;
  }

  res.json(data ?? []);
});
