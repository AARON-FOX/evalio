import { Router } from "express";
import { z } from "zod";

import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth, requireCreator } from "../middleware/requireAuth.js";

export const testArchiveRouter = Router();
const uuid = z.string().uuid();

// Applies only to /api/tests/:id and its descendants. Keeps archived tests
// inaccessible even if an outdated UI still knows an old version UUID.
testArchiveRouter.use("/:id", requireAuth, async (req, res, next) => {
  const parsed = uuid.safeParse(req.params.id);
  if (!parsed.success) return next();

  const testResult = await supabaseAdmin
    .from("tests")
    .select("series_id")
    .eq("id", parsed.data)
    .maybeSingle();
  if (testResult.error) {
    console.error("Archived test access check:", testResult.error);
    res.status(502).json({ message: "Could not check test availability" });
    return;
  }
  if (!testResult.data) return next();

  const archivedResult = await supabaseAdmin
    .from("archived_test_series")
    .select("series_id")
    .eq("series_id", testResult.data.series_id)
    .maybeSingle();
  if (archivedResult.error) {
    console.error("Archived test series lookup:", archivedResult.error);
    res.status(502).json({ message: "Could not check test availability" });
    return;
  }
  if (archivedResult.data) {
    res
      .status(404)
      .json({
        message: "Тест видалено або він недоступний.",
        code: "test_archived",
      });
    return;
  }
  next();
});

// Logical deletion: archive the WHOLE test series, never cascade-delete
// questions/submissions. The database RPC verifies owner + active attempts
// atomically and serializes against a concurrent test start.
testArchiveRouter.delete(
  "/:id",
  requireAuth,
  requireCreator,
  async (req, res) => {
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) {
      res.status(400).json({ message: "Некоректний ID тесту." });
      return;
    }
    const { data, error } = await supabaseAdmin.rpc(
      "evalio_archive_test_series",
      {
        p_test_id: parsed.data,
        p_creator_id: req.authUser!.id,
      },
    );
    if (error) {
      if (error.message.includes("test_not_owned")) {
        res.status(404).json({ message: "Тест не знайдено." });
        return;
      }
      if (error.message.includes("test_has_active_attempts")) {
        res.status(409).json({
          message:
            "Тест зараз проходить студент. Видалити його можна після завершення активної спроби.",
          code: "test_has_active_attempts",
        });
        return;
      }
      console.error("Archive test RPC error:", error);
      res.status(502).json({ message: "Не вдалося видалити тест." });
      return;
    }
    res.json({
      ...data,
      message: "Тест прибрано зі списків. Результати студентів збережено.",
    });
  },
);
