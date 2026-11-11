import { invalidateTeacherData } from "../app/cacheInvalidation";
import { supabase } from "../lib/supabase";

const BASE = import.meta.env.VITE_API_URL;

export interface VersionRecord {
  id: string;
  series_id: string;
  version_number: number;
  status: "draft" | "published";
  is_current: boolean;
  title: string;
  created_at: string;
}

export interface TestSettings {
  id: string;
  series_id: string;
  version_number: number;
  is_current: boolean;
  title: string;
  description: string | null;
  kind: "test" | "survey";
  status: "draft" | "published";
  subject: string | null;
  class_group: string | null;
  duration_minutes: number | null;
  max_attempts: number | null;
  available_until: string | null;
  show_result_immediately: boolean;
  show_correct_answers: boolean;
  shuffle_questions: boolean;
}

export interface TestSettingsInput {
  subject?: string | null;
  classGroup?: string | null;
  durationMinutes?: number | null;
  maxAttempts?: number | null;
  availableUntil?: string | null;
  showResultImmediately?: boolean;
  showCorrectAnswers?: boolean;
  shuffleQuestions?: boolean;
}

export interface WeightedQuestionInput {
  text: string;
  questionType: "single_choice" | "multiple_choice";
  points: number;
  explanation: string | null;
  options: { text: string; isCorrect: boolean }[];
}

async function request<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown,
): Promise<T> {
  if (!BASE) throw new Error("VITE_API_URL is missing");
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session) throw new Error("Authentication required");

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      result &&
      typeof result === "object" &&
      "message" in result &&
      typeof result.message === "string"
        ? result.message
        : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return result as T;
}

export function createDraftRevision(publishedId: string) {
  return request<{ draftId: string }>(
    `/api/tests/${encodeURIComponent(publishedId)}/revisions`,
    "POST",
  ).then((result) => {
    invalidateTeacherData();
    return result;
  });
}

export function getVersions(testId: string) {
  return request<VersionRecord[]>(
    `/api/tests/${encodeURIComponent(testId)}/versions`,
  );
}

export function getTestSettings(testId: string) {
  return request<TestSettings>(
    `/api/tests/${encodeURIComponent(testId)}/settings`,
  );
}

export function updateTestSettings(testId: string, input: TestSettingsInput) {
  return request<TestSettings>(
    `/api/tests/${encodeURIComponent(testId)}/settings`,
    "PATCH",
    input,
  ).then((result) => {
    invalidateTeacherData();
    return result;
  });
}

// Both request bodies require corresponding updates to the existing
// addQuestionSchema and backend question routes (see README).
export function addWeightedQuestion(
  testId: string,
  input: WeightedQuestionInput,
) {
  return request<{ id: string; message: string }>(
    `/api/tests/${encodeURIComponent(testId)}/questions`,
    "POST",
    input,
  ).then((result) => {
    invalidateTeacherData();
    return result;
  });
}

export function updateWeightedQuestion(
  testId: string,
  questionId: string,
  input: WeightedQuestionInput,
) {
  return request<{ id: string; message: string }>(
    `/api/tests/${encodeURIComponent(testId)}/questions/${encodeURIComponent(questionId)}`,
    "PATCH",
    input,
  ).then((result) => {
    invalidateTeacherData();
    return result;
  });
}
