import { Router } from "express";

import { requireAuth, requireRespondent } from "../middleware/requireAuth.js";

export const legacySubmissionGuard = Router();
legacySubmissionGuard.post(
  "/:id/submissions",
  requireAuth,
  requireRespondent,
  (_req, res) => {
    res.status(410).json({
      message: "Use the new active attempt endpoints",
      code: "legacy_submission_disabled",
    });
  },
);
