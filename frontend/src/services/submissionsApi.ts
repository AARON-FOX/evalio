import { supabase } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL;

export interface SelectedAnswer {
  questionId: string;
  optionIds: string[];
}

export interface SubmissionResult {
  id: string;
  testId: string;
  kind: 'test' | 'survey';
  resultVisible: boolean;
  score: number | null;
  maxScore: number | null;
  submittedAt: string;
}

export interface SubmissionHistory {
  id: string;
  test_id: string;
  kind: 'test' | 'survey' | null;
  result_visible: boolean;
  score: number | null;
  max_score: number | null;
  submitted_at: string;
}

async function request<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
): Promise<T> {
  if (!API_URL) {
    throw new Error("VITE_API_URL is missing");
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session) {
    throw new Error("Authentication required");
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message === "string"
        ? data.message
        : `Request failed: ${response.status}`;

    throw new Error(message);
  }

  return data as T;
}

export function submitTest(testId: string, answers: SelectedAnswer[]) {
  return request<SubmissionResult>(
    `/api/tests/${encodeURIComponent(testId)}/submissions`,
    {
      method: "POST",
      body: { answers },
    },
  );
}

export function getMySubmissions() {
  return request<SubmissionHistory[]>("/api/submissions/mine");
}
