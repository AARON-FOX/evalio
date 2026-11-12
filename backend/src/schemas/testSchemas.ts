import { z } from "zod";

const title = z.string().trim().min(1).max(200);

export const createTestSchema = z.strictObject({
  title,
  description: z.string().trim().max(2000).nullable().optional(),
  kind: z.enum(["test", "survey"]).default("test"),
});

export const updateTestSchema = z
  .strictObject({
    title: title.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const imagePath = z.string().max(255).regex(
  /^[a-f\d-]{36}\/[a-f\d-]{36}\/[a-f\d-]{36}\.(jpg|jpeg|png|webp|gif)$/i,
).nullable().optional();

export const addQuestionSchema = z.strictObject({
  imagePath,
  text: z.string().trim().min(1).max(5000),
  questionType: z.enum(["single_choice", "multiple_choice"]),
  options: z
    .array(
      z.strictObject({
        text: z.string().trim().min(1).max(1000),
        isCorrect: z.boolean(),
        imagePath,
        imageOnly: z.boolean().optional(),
      }),
    )
    .min(2)
    .max(12),
  points: z.number().int().min(1).max(100).default(1),
  explanation: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});
