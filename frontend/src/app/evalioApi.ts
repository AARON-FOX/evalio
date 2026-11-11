import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { supabase } from "../lib/supabase";
import type {
  DashboardStatus,
  StudentDashboardData,
  TeacherDashboardData,
} from "../services/dashboardApi";
import type { CatalogTest } from "../services/activeAttemptsApi";
import type { TeacherTestsResponse } from "../services/teacherStatisticsApi";
import type { SubmissionHistory } from "../services/submissionsApi";
import type { SubmissionDetail } from "../services/submissionResultApi";
import type { CreateTestInput, TestRecord } from "../services/testsApi";

const baseUrl = import.meta.env.VITE_API_URL;
if (!baseUrl) throw new Error("VITE_API_URL is missing");

export interface TeacherDashboardParams {
  page: number;
  status: DashboardStatus;
  search: string;
}

export const evalioApi = createApi({
  reducerPath: "evalioApi",
  baseQuery: fetchBaseQuery({
    baseUrl,
    prepareHeaders: async (headers) => {
      // Do not store JWT in Redux or browser-persisted state.
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (error || !session) throw new Error("Потрібно увійти в акаунт.");
      headers.set("Authorization", `Bearer ${session.access_token}`);
      return headers;
    },
  }),
  tagTypes: [
    "Catalog",
    "TeacherTests",
    "TeacherDashboard",
    "StudentDashboard",
    "SubmissionHistory",
    "SubmissionDetail",
  ],
  keepUnusedDataFor: 30,
  refetchOnFocus: true,
  refetchOnReconnect: true,
  endpoints: (builder) => ({
    getCatalog: builder.query<CatalogTest[], void>({
      query: () => "/api/tests",
      transformResponse: (response: unknown) => {
        const list = Array.isArray(response)
          ? response
          : response &&
              typeof response === "object" &&
              "items" in response &&
              Array.isArray(response.items)
            ? response.items
            : response &&
                typeof response === "object" &&
                "tests" in response &&
                Array.isArray(response.tests)
              ? response.tests
              : null;
        if (!list) throw new Error("Невідомий формат списку тестів від API.");
        return list as CatalogTest[];
      },
      providesTags: ["Catalog"],
    }),
    getStudentDashboard: builder.query<StudentDashboardData, void>({
      query: () => "/api/dashboard/student",
      providesTags: ["StudentDashboard"],
    }),
    getTeacherDashboard: builder.query<
      TeacherDashboardData,
      TeacherDashboardParams
    >({
      query: ({ page, status, search }) => ({
        url: "/api/dashboard/teacher",
        params: { page, status, q: search },
      }),
      providesTags: ["TeacherDashboard"],
    }),
    getTeacherTests: builder.query<TeacherTestsResponse, number>({
      query: (page) => ({ url: "/api/teacher/tests", params: { page } }),
      providesTags: ["TeacherTests"],
    }),
    getMySubmissions: builder.query<SubmissionHistory[], void>({
      query: () => "/api/submissions/mine",
      providesTags: ["SubmissionHistory"],
    }),
    getSubmissionDetail: builder.query<SubmissionDetail, string>({
      query: (id) => `/api/submissions/${encodeURIComponent(id)}/result`,
      providesTags: (_result, _error, id) => [{ type: "SubmissionDetail", id }],
    }),
    createTest: builder.mutation<TestRecord, CreateTestInput>({
      query: (body) => ({ url: "/api/tests", method: "POST", body }),
      invalidatesTags: ["TeacherTests", "TeacherDashboard"],
    }),
    publishTest: builder.mutation<
      { id: string; status: "published"; message: string },
      string
    >({
      query: (id) => ({
        url: `/api/tests/${encodeURIComponent(id)}/publish`,
        method: "POST",
      }),
      invalidatesTags: [
        "TeacherTests",
        "TeacherDashboard",
        "Catalog",
        "StudentDashboard",
      ],
    }),
  }),
});

export const {
  useGetCatalogQuery,
  useGetStudentDashboardQuery,
  useGetTeacherDashboardQuery,
  useGetTeacherTestsQuery,
  useGetMySubmissionsQuery,
  useGetSubmissionDetailQuery,
  useCreateTestMutation,
  usePublishTestMutation,
} = evalioApi;
