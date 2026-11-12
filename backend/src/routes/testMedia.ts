import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireCreator } from "../middleware/requireAuth.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import {
  MAX_TEST_IMAGE_BYTES,
  TEST_IMAGE_BUCKET,
  TEST_IMAGE_TYPES,
  isOwnImagePath,
} from "../lib/testMedia.js";

export const testMediaRouter = Router();
const uuid = z.string().uuid();
const uploadSchema = z.strictObject({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  size: z.number().int().positive().max(MAX_TEST_IMAGE_BYTES),
});

async function ownedDraft(testId: string, ownerId: string) {
  const { data, error } = await supabaseAdmin
    .from("evalio_unarchived_tests")
    .select("id")
    .eq("id", testId)
    .eq("creator_id", ownerId)
    .eq("status", "draft")
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Only an owner of an unarchived DRAFT can ask for an upload token.
// The token authorizes a SINGLE path (2-hour expiry, no upsert).
testMediaRouter.post(
  "/:testId/media/upload-token",
  requireAuth,
  requireCreator,
  async (req, res) => {
    const testId = uuid.safeParse(req.params.testId);
    const parsed = uploadSchema.safeParse(req.body);
    if (!testId.success || !parsed.success) {
      res
        .status(400)
        .json({ message: "Зображення: JPG/PNG/WebP/GIF до 3 МБ." });
      return;
    }
    try {
      if (!(await ownedDraft(testId.data, req.authUser!.id))) {
        res.status(404).json({ message: "Чернетку не знайдено." });
        return;
      }
      const ext = TEST_IMAGE_TYPES[parsed.data.mimeType];
      const path = `${req.authUser!.id}/${testId.data}/${randomUUID()}.${ext}`;
      const { data, error } = await supabaseAdmin.storage
        .from(TEST_IMAGE_BUCKET)
        .createSignedUploadUrl(path, { upsert: false });
      if (error || !data)
        throw error ?? new Error("Cannot generate upload token");
      res.status(201).json({ path, token: data.token });
    } catch (error) {
      console.error("Image upload-token error:", error);
      res.status(502).json({ message: "Не вдалося підготувати завантаження." });
    }
  },
);

// Only the creator may sign a newly uploaded image for an editor preview.
// Signed URLs are short-lived; the path, not the URL, goes into PostgreSQL.
testMediaRouter.post(
  "/:testId/media/preview-url",
  requireAuth,
  requireCreator,
  async (req, res) => {
    const testId = uuid.safeParse(req.params.testId);
    const input = z
      .strictObject({ path: z.string().max(255) })
      .safeParse(req.body);
    if (!testId.success || !input.success) {
      res.status(400).json({ message: "Неправильний шлях зображення." });
      return;
    }
    try {
      if (
        !(await ownedDraft(testId.data, req.authUser!.id)) ||
        !isOwnImagePath(input.data.path, req.authUser!.id)
      ) {
        res.status(404).json({ message: "Зображення недоступне." });
        return;
      }
      const { data, error } = await supabaseAdmin.storage
        .from(TEST_IMAGE_BUCKET)
        .createSignedUrl(input.data.path, 3600);
      if (error || !data) throw error ?? new Error("Cannot sign image");
      res.json({ imageUrl: data.signedUrl });
    } catch (error) {
      console.error("Image preview-sign error:", error);
      res.status(502).json({ message: "Не вдалося відкрити зображення." });
    }
  },
);
