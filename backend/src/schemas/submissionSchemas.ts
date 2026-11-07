import { z } from "zod";

const answerSchema = z.strictObject({
  questionId: z.string().uuid(),

  optionIds: z
    .array(z.string().uuid())
    .min(1)
    .max(12)
    .refine(
      (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
      "Duplicate options are not allowed",
    ),
});

export const submitTestSchema = z.strictObject({
  answers: z
    .array(answerSchema)
    .min(1)
    .max(100)
    .refine(
      (answers) =>
        new Set(answers.map((answer) => answer.questionId.toLowerCase()))
          .size === answers.length,
      "Duplicate questions are not allowed",
    ),
});
