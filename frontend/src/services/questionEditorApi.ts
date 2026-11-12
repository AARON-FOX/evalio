import { invalidateTeacherData } from "../app/cacheInvalidation";
import { supabase } from "../lib/supabase";
import type { AddQuestionInput, TestDetails } from "./testsApi";

const API_URL = import.meta.env.VITE_API_URL;

export interface EditableOption {
  id: string;
  text: string;
  position: number;
  isCorrect: boolean;
  image_path: string | null;
  image_only: boolean;
  imageOnly?: boolean;
  imageUrl: string | null;
}

export interface EditableQuestion {
  id: string;
  text: string;
  question_type: "single_choice" | "multiple_choice";
  position: number;
  points: number;
  explanation: string | null;
  image_path: string | null;
  imageUrl: string | null;
  options: EditableOption[];
}

export interface EditableTest extends Omit<TestDetails, "questions"> {
  questions: EditableQuestion[];
}

async function request<T>(
  path: string,
  method: "GET" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  if (!API_URL) throw new Error("VITE_API_URL is missing");
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session) throw new Error("Authentication required");

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result: unknown =
    response.status === 204 ? null : await response.json().catch(() => null);

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

export function getEditableTest(testId: string) {
  return request<EditableTest>(
    `/api/tests/${encodeURIComponent(testId)}/editor`,
  );
}

export function updateDraftQuestion(
  testId: string,
  questionId: string,
  input: AddQuestionInput,
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

export function deleteDraftQuestion(testId: string, questionId: string) {
  return request<null>(
    `/api/tests/${encodeURIComponent(testId)}/questions/${encodeURIComponent(questionId)}`,
    "DELETE",
  ).then((result) => {
    invalidateTeacherData();
    return result;
  });
}
