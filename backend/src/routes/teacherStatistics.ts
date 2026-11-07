import { Router } from "express";
import { z } from "zod";

import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth, requireCreator } from "../middleware/requireAuth.js";

export const teacherStatisticsRouter = Router();

const uuidSchema = z.string().uuid();
const pageSchema = z.coerce.number().int().min(1).max(10000).default(1);

teacherStatisticsRouter.use(requireAuth);
teacherStatisticsRouter.use(requireCreator);

// GET /api/teacher/tests
// Paginated list of tests owned by the creator.
teacherStatisticsRouter.get("/tests", async (req, res) => {
  const parsed = pageSchema.safeParse(req.query.page);

  if (!parsed.success) {
    res.status(400).json({ message: "Invalid page" });
    return;
  }

  const page = parsed.data;
  const pageSize = 20;
  const from = (page - 1) * pageSize;

  const { data, count, error } = await supabaseAdmin
    .from("tests")
    .select("id, title, kind, status, created_at", { count: "exact" })
    .eq("creator_id", req.authUser!.id)
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) {
    console.error("Teacher tests error:", error);
    res.status(502).json({
      message: "Could not load teacher tests",
    });
    return;
  }

  res.json({
    items: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  });
});

// GET /api/teacher/tests/:id/statistics
teacherStatisticsRouter.get("/tests/:id/statistics", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);

  if (!id.success) {
    res.status(400).json({
      message: "Invalid test ID",
    });
    return;
  }

  const { data, error } = await supabaseAdmin.rpc("evalio_test_statistics", {
    p_test_id: id.data,
    p_creator_id: req.authUser!.id,
  });

  if (error) {
    if (error.message.includes("test_not_owned")) {
      res.status(404).json({
        message: "Test not found",
      });
      return;
    }

    console.error("Statistics error:", error);
    res.status(502).json({
      message: "Could not load statistics",
    });
    return;
  }

  res.json(data);
});

// GET /api/teacher/tests/:id/submissions/:submissionId
teacherStatisticsRouter.get(
  "/tests/:id/submissions/:submissionId",
  async (req, res) => {
    const testId = uuidSchema.safeParse(req.params.id);
    const submissionId = uuidSchema.safeParse(req.params.submissionId);

    if (!testId.success || !submissionId.success) {
      res.status(400).json({
        message: "Invalid identifier",
      });
      return;
    }

    const { data, error } = await supabaseAdmin.rpc(
      "evalio_submission_details",
      {
        p_test_id: testId.data,
        p_creator_id: req.authUser!.id,
        p_submission_id: submissionId.data,
      },
    );

    if (error) {
      if (
        error.message.includes("test_not_owned") ||
        error.message.includes("submission_not_found")
      ) {
        res.status(404).json({
          message: "Submission not found",
        });
        return;
      }

      console.error("Submission details error:", error);
      res.status(502).json({
        message: "Could not load submission",
      });
      return;
    }

    res.json(data);
  },
);
