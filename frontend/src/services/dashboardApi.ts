import { supabase } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL;

export type DashboardStatus = "all" | "draft" | "published";

export interface TeacherDashboardTest {
  id: string;
  title: string;
  description: string | null;
  kind: "test" | "survey";
  status: "draft" | "published";
  createdAt: string;
  participantCount: number;
  averagePercent: number | null;
}

export interface TeacherRecentSubmission {
  id: string;
  testId: string;
  testTitle: string;
  respondentId: string;
  score: number | null;
  maxScore: number | null;
  submittedAt: string;
}

export interface TeacherDashboardData {
  stats: {
    totalTests: number;
    publishedTests: number;
    draftTests: number;
    totalAttempts: number;
    averagePercent: number | null;
  };
  items: TeacherDashboardTest[];
  total: number;
  page: number;
  pageSize: number;
  recentSubmissions: TeacherRecentSubmission[];
}

export interface StudentDashboardTest {
  id: string;
  title: string;
  description: string | null;
  kind: "test" | "survey";
  questionCount: number;
}

export interface StudentRecentSubmission {
  id: string;
  testId: string;
  testTitle: string;
  kind: 'test' | 'survey';
  resultVisible: boolean;
  score: number | null;
  maxScore: number | null;
  submittedAt: string;
}

export interface StudentDashboardData {
  availableCount: number;
  completedTests: number;
  totalAttempts: number;
  averagePercent: number | null;
  availableTests: StudentDashboardTest[];
  recentSubmissions: StudentRecentSubmission[];
}

async function authorizedGet<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  if (!API_URL) throw new Error("VITE_API_URL is missing");
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session) throw new Error("Authentication required");

  const response = await fetch(`${API_URL}${path}`, {
    signal,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    if (
      result &&
      typeof result === "object" &&
      "message" in result &&
      typeof result.message === "string"
    )
      message = result.message;
    throw new Error(message);
  }
  return result as T;
}

export function getTeacherDashboard(
  args: { page: number; status: DashboardStatus; search: string },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    page: String(args.page),
    status: args.status,
    q: args.search,
  });
  return authorizedGet<TeacherDashboardData>(
    `/api/dashboard/teacher?${params.toString()}`,
    signal,
  );
}

export function getStudentDashboard(signal?: AbortSignal) {
  return authorizedGet<StudentDashboardData>("/api/dashboard/student", signal);
}
