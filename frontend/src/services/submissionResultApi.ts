import { supabase } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL;

export type QuestionOutcome = "correct" | "incorrect" | "unanswered";

export interface AnswerSummary {
  id: string;
  text: string;
}

export interface ReviewedQuestion {
  id: string;
  text: string;
  status: QuestionOutcome;
  points: number;
  earnedPoints: number;
  selectedOptions: AnswerSummary[];
  correctOptions: AnswerSummary[];
  explanation: string | null;
}

export interface SubmissionDetail {
  id: string;
  testId: string;
  testTitle: string;
  subject: string | null;
  classGroup: string | null;
  versionNumber: number;
  kind: "test" | "survey";
  submittedAt: string;
  durationSeconds: number | null;
  finishReason: "manual" | "timeout" | null;
  resultVisible: boolean;
  reviewVisible: boolean;
  score: number | null;
  maxScore: number | null;
  totalQuestions: number;
  correctCount: number | null;
  incorrectCount: number | null;
  unansweredCount: number | null;
  questions: ReviewedQuestion[];
}

export async function getSubmissionDetail(
  submissionId: string,
  signal?: AbortSignal,
): Promise<SubmissionDetail> {
  if (!API_URL) throw new Error("VITE_API_URL is missing");
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session) throw new Error("Потрібно увійти в акаунт.");

  const response = await fetch(
    `${API_URL}/api/submissions/${encodeURIComponent(submissionId)}/result`,
    {
      signal,
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  );
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    let message = `Не вдалося отримати результат (${response.status}).`;
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message === "string"
    )
      message = data.message;
    throw new Error(message);
  }
  return data as SubmissionDetail;
}
