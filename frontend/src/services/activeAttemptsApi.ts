import { invalidateStudentProgress } from "../app/cacheInvalidation";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

export interface RunnerQuestion {
  id: string;
  text: string;
  questionType: "single_choice" | "multiple_choice";
  points: number;
  options: { id: string; text: string }[];
}

export interface RunnerResult {
  id: string;
  testId: string;
  kind: "test" | "survey";
  resultVisible: boolean;
  score: number | null;
  maxScore: number | null;
  submittedAt: string;
  reason: "manual" | "timeout";
}

export type RunnerState =
  | {
      id: string;
      status: "active";
      testId: string;
      title: string;
      description: string | null;
      subject: string | null;
      classGroup: string | null;
      kind: "test" | "survey";
      startedAt: string;
      expiresAt: string | null;
      serverNow: string;
      answers: Record<string, string[]>;
      questions: RunnerQuestion[];
    }
  | {
      id: string;
      status: "submitted";
      testId: string;
      title: string;
      result: RunnerResult;
    };

export interface CatalogTest {
  id: string;
  title: string;
  description: string | null;
  kind: "test" | "survey";
  subject?: string | null;
  class_group?: string | null;
  max_attempts?: number | null;
  available_until?: string | null;
  usedAttempts?: number;
  remainingAttempts?: number | null;
  hasActiveAttempt?: boolean;
}

async function request<T>(
  path: string,
  method: "GET" | "POST" | "PUT" = "GET",
  body?: unknown,
): Promise<T> {
  if (!API) throw new Error("VITE_API_URL is missing");
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError || !session) throw new Error("Потрібно увійти в акаунт.");
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message === "string"
        ? data.message
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function startRunnerAttempt(testId: string) {
  return request<{ attemptId: string; resumed: boolean }>(
    "/api/attempts/start",
    "POST",
    { testId },
  );
}

export function getRunnerAttempt(attemptId: string) {
  return request<RunnerState>(`/api/attempts/${encodeURIComponent(attemptId)}`);
}

export function saveRunnerAnswer(
  attemptId: string,
  questionId: string,
  optionIds: string[],
) {
  return request<{ questionId: string; optionIds: string[]; savedAt: string }>(
    `/api/attempts/${encodeURIComponent(attemptId)}/answer`,
    "PUT",
    { questionId, optionIds },
  );
}

export function finishRunnerAttempt(attemptId: string) {
  return request<RunnerResult>(
    `/api/attempts/${encodeURIComponent(attemptId)}/finish`,
    "POST",
  ).then((result) => {
    invalidateStudentProgress();
    return result;
  });
}

export async function getRunnerCatalog(): Promise<CatalogTest[]> {
  const response = await request<unknown>("/api/tests");
  // Existing Evalio installations may wrap collection responses.
  const list = Array.isArray(response)
    ? response
    : response && typeof response === "object"
      ? "items" in response && Array.isArray(response.items)
        ? response.items
        : "tests" in response && Array.isArray(response.tests)
          ? response.tests
          : null
      : null;
  if (!list) throw new Error("Невідомий формат списку тестів від API.");
  return list as CatalogTest[];
}
