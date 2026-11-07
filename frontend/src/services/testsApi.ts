import { supabase } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  throw new Error("VITE_API_URL is missing");
}

export type TestKind = "test" | "survey";
export type TestStatus = "draft" | "published";

export type QuestionType = "single_choice" | "multiple_choice";

export interface TestRecord {
  id: string;
  creator_id: string;
  title: string;
  description: string | null;
  kind: TestKind;
  status: TestStatus;
  created_at: string;
}

export interface AnswerOption {
  id: string;
  text: string;
  position: number;
}

export interface TestQuestion {
  id: string;
  text: string;
  question_type: QuestionType;
  position: number;
  options: AnswerOption[];
}

export interface TestDetails extends TestRecord {
  questions: TestQuestion[];
}

export interface CreateTestInput {
  title: string;
  description: string | null;
  kind: TestKind;
}

export interface AddQuestionInput {
  text: string;
  questionType: QuestionType;
  options: {
    text: string;
    isCorrect: boolean;
  }[];
}

async function apiRequest<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown,
): Promise<T> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session) {
    throw new Error("Authentication required");
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const result: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;

    if (
      result &&
      typeof result === "object" &&
      "message" in result &&
      typeof result.message === "string"
    ) {
      message = result.message;
    }

    throw new Error(message);
  }

  return result as T;
}

// GET /api/tests
export function getTests() {
  return apiRequest<TestRecord[]>("/api/tests");
}

// GET /api/tests/:id
export function getTestDetails(id: string) {
  return apiRequest<TestDetails>(`/api/tests/${encodeURIComponent(id)}`);
}

// POST /api/tests
export function createTest(input: CreateTestInput) {
  return apiRequest<TestRecord>("/api/tests", "POST", input);
}

// PATCH /api/tests/:id
export function updateTest(
  id: string,
  input: {
    title?: string;
    description?: string | null;
  },
) {
  return apiRequest<TestRecord>(
    `/api/tests/${encodeURIComponent(id)}`,
    "PATCH",
    input,
  );
}

// POST /api/tests/:id/questions
export function addTestQuestion(id: string, input: AddQuestionInput) {
  return apiRequest<{ id: string; message: string }>(
    `/api/tests/${encodeURIComponent(id)}/questions`,
    "POST",
    input,
  );
}

// POST /api/tests/:id/publish
export function publishTest(id: string) {
  return apiRequest<{
    id: string;
    status: "published";
    message: string;
  }>(`/api/tests/${encodeURIComponent(id)}/publish`, "POST");
}
