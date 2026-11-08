import { Router } from "express";
import { z } from "zod";

import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import {
  requireAuth,
  requireCreator,
  requireRespondent,
} from "../middleware/requireAuth.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

const teacherQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  status: z.enum(["all", "draft", "published"]).default("all"),
  q: z.string().trim().max(100).default(""),
});

dashboardRouter.get("/teacher", requireCreator, async (req, res) => {
  const query = teacherQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: "Invalid dashboard filters" });
    return;
  }

  const { data, error } = await supabaseAdmin.rpc("evalio_creator_dashboard", {
    p_creator_id: req.authUser!.id,
    p_page: query.data.page,
    p_status: query.data.status,
    p_search: query.data.q,
  });

  if (error) {
    console.error("Teacher dashboard:", error);
    res.status(502).json({ message: "Could not load dashboard" });
    return;
  }
  res.json(data);
});

dashboardRouter.get("/student", requireRespondent, async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc(
    "evalio_respondent_dashboard",
    {
      p_respondent_id: req.authUser!.id,
    },
  );
  if (error) {
    console.error("Student dashboard:", error);
    res.status(502).json({ message: "Could not load dashboard" });
    return;
  }
  res.json(data);
});
