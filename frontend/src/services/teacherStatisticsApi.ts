import { supabase } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL;

export interface TeacherTest {
  id: string;
  title: string;
  kind: "test" | "survey";
  status: "draft" | "published";
  created_at: string;
}

export interface TeacherTestsResponse {
  items: TeacherTest[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StatisticsAttempt {
  id: string;
  respondentId: string;
  score: number | null;
  maxScore: number | null;
  submittedAt: string;
}

export interface TestStatistics {
  testId: string;
  title: string;
  kind: "test" | "survey";
  status: "draft" | "published";
  totalAttempts: number;
  uniqueRespondents: number;
  averageScore: number | null;
  averagePercent: number | null;
  recentSubmissions: StatisticsAttempt[];
}

export interface SubmissionQuestion {
  questionId: string;
  text: string;
  questionType: "single_choice" | "multiple_choice";
  selectedOptions: {
    id: string;
    text: string;
  }[];
  isCorrect: boolean | null;
}

export interface SubmissionDetails {
  id: string;
  respondentId: string;
  score: number | null;
  maxScore: number | null;
  submittedAt: string;
  questions: SubmissionQuestion[];
}

async function request<T>(path: string): Promise<T> {
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
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
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

export function getTeacherTests(page = 1) {
  return request<TeacherTestsResponse>(`/api/teacher/tests?page=${page}`);
}

export function getTestStatistics(testId: string) {
  return request<TestStatistics>(
    `/api/teacher/tests/${encodeURIComponent(testId)}/statistics`,
  );
}

export function getSubmissionDetails(testId: string, submissionId: string) {
  return request<SubmissionDetails>(
    `/api/teacher/tests/${encodeURIComponent(testId)}` +
      `/submissions/${encodeURIComponent(submissionId)}`,
  );
}
