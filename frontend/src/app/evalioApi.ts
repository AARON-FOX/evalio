import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { supabase } from "../lib/supabase";
import type {
  DashboardStatus,
  StudentDashboardData,
  TeacherDashboardData,
} from "../services/dashboardApi";
import type { CatalogTest } from "../services/activeAttemptsApi";
import type {
  TeacherTestsResponse,
  TestStatistics,
  SubmissionDetails,
} from "../services/teacherStatisticsApi";
import type { TestDetails } from "../services/testsApi";
import type { EditableTest } from "../services/questionEditorApi";
import type {
  TestSettings,
  TestSettingsInput,
  VersionRecord,
  WeightedQuestionInput,
} from "../services/testVersioningApi";
import type { RunnerState, RunnerResult } from "../services/activeAttemptsApi";
import type { TestOverview } from "../services/testOverviewTypes";
import type { SubmissionHistory } from "../services/submissionsApi";
import type { SubmissionDetail } from "../services/submissionResultApi";
import type { CreateTestInput, TestRecord } from "../services/testsApi";
import type {
  AdminUsersResponse,
  AdminUserQuery,
  AdminRoleChange,
  ChangeRoleRequest,
  ChangeRoleResult,
} from "../services/adminApiTypes";

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
    "TestSettings",
    "TestVersions",
    "TestEditor",
    "TestDetails",
    "TeacherStatistics",
    "TeacherSubmissionDetails",
    "RunnerAttempt",
    "AdminUsers",
    "AdminAudit",
    "TestOverview",
  ],
  keepUnusedDataFor: 30,
  refetchOnFocus: true,
  refetchOnReconnect: true,
  endpoints: (builder) => ({
    getAdminUsers: builder.query<AdminUsersResponse, AdminUserQuery>({
      query: ({ page, search, role }) => ({
        url: "/api/admin/users",
        params: { page, search, role },
      }),
      providesTags: ["AdminUsers"],
    }),
    getAdminAudit: builder.query<AdminRoleChange[], void>({
      query: () => "/api/admin/audit",
      providesTags: ["AdminAudit"],
    }),
    changeUserRole: builder.mutation<ChangeRoleResult, ChangeRoleRequest>({
      query: ({ userId, ...body }) => ({
        url: `/api/admin/users/${encodeURIComponent(userId)}/role`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (_result, error) =>
        error ? [] : ["AdminUsers", "AdminAudit"],
    }),
    getTestOverview: builder.query<TestOverview, string>({
      query: (id) => `/api/tests/${encodeURIComponent(id)}/overview`,
      providesTags: (_result, _error, id) => [{ type: "TestOverview", id }],
    }),
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
      invalidatesTags: (_result, error) =>
        error ? [] : ["TeacherTests", "TeacherDashboard"],
    }),
    deleteTest: builder.mutation<
      { seriesId: string; archivedAt: string; message: string },
      string
    >({
      query: (id) => ({
        url: `/api/tests/${encodeURIComponent(id)}`,
        method: "DELETE",
      }),
      invalidatesTags: (_result, error) =>
        error
          ? []
          : [
              "TeacherTests",
              "TeacherDashboard",
              "Catalog",
              "StudentDashboard",
              "TeacherStatistics",
              "TestVersions",
              "TestSettings",
              "TestEditor",
              "TestDetails",
              "TestOverview",
            ],
    }),
    publishTest: builder.mutation<
      { id: string; status: "published"; message: string },
      string
    >({
      query: (id) => ({
        url: `/api/tests/${encodeURIComponent(id)}/publish`,
        method: "POST",
      }),
      invalidatesTags: (_result, error, id) =>
        error
          ? []
          : [
              "TeacherTests",
              "TeacherDashboard",
              "Catalog",
              "StudentDashboard",
              { type: "TestSettings", id },
              { type: "TestVersions", id },
              { type: "TestEditor", id },
              { type: "TestDetails", id },
            ],
    }),
    // Teacher statistics. Selected test/submission IDs are query cache keys.
    getTestStatistics: builder.query<TestStatistics, string>({
      query: (id) => `/api/teacher/tests/${encodeURIComponent(id)}/statistics`,
      providesTags: (_result, _error, id) => [
        { type: "TeacherStatistics", id },
      ],
    }),
    getTeacherSubmissionDetails: builder.query<
      SubmissionDetails,
      { testId: string; submissionId: string }
    >({
      query: ({ testId, submissionId }) =>
        `/api/teacher/tests/${encodeURIComponent(testId)}/submissions/${encodeURIComponent(submissionId)}`,
      providesTags: (_result, _error, { submissionId }) => [
        { type: "TeacherSubmissionDetails", id: submissionId },
      ],
    }),

    // Test editor: authorized creator-only endpoints.
    getTestSettings: builder.query<TestSettings, string>({
      query: (id) => `/api/tests/${encodeURIComponent(id)}/settings`,
      providesTags: (_result, _error, id) => [{ type: "TestSettings", id }],
    }),
    getTestVersions: builder.query<VersionRecord[], string>({
      query: (id) => `/api/tests/${encodeURIComponent(id)}/versions`,
      providesTags: (_result, _error, id) => [{ type: "TestVersions", id }],
    }),
    getDraftEditor: builder.query<EditableTest, string>({
      query: (id) => `/api/tests/${encodeURIComponent(id)}/editor`,
      providesTags: (_result, _error, id) => [{ type: "TestEditor", id }],
    }),
    getTestDetails: builder.query<TestDetails, string>({
      query: (id) => `/api/tests/${encodeURIComponent(id)}`,
      providesTags: (_result, _error, id) => [{ type: "TestDetails", id }],
    }),
    updateTestMetadata: builder.mutation<
      TestRecord,
      { id: string; title?: string; description?: string | null }
    >({
      query: ({ id, ...body }) => ({
        url: `/api/tests/${encodeURIComponent(id)}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (_result, error, { id }) =>
        error
          ? []
          : [
              "TeacherTests",
              "TeacherDashboard",
              { type: "TestEditor", id },
              { type: "TestSettings", id },
            ],
    }),
    updateTestSettings: builder.mutation<
      TestSettings,
      { id: string; input: TestSettingsInput }
    >({
      query: ({ id, input }) => ({
        url: `/api/tests/${encodeURIComponent(id)}/settings`,
        method: "PATCH",
        body: input,
      }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : ["TeacherDashboard", { type: "TestSettings", id }],
    }),
    createDraftRevision: builder.mutation<{ draftId: string }, string>({
      query: (id) => ({
        url: `/api/tests/${encodeURIComponent(id)}/revisions`,
        method: "POST",
      }),
      invalidatesTags: (_result, error, id) =>
        error
          ? []
          : ["TeacherTests", "TeacherDashboard", { type: "TestVersions", id }],
    }),
    addWeightedQuestion: builder.mutation<
      { id: string; message: string },
      { testId: string; input: WeightedQuestionInput }
    >({
      query: ({ testId, input }) => ({
        url: `/api/tests/${encodeURIComponent(testId)}/questions`,
        method: "POST",
        body: input,
      }),
      invalidatesTags: (_result, error, { testId }) =>
        error ? [] : ["TeacherDashboard", { type: "TestEditor", id: testId }],
    }),
    updateWeightedQuestion: builder.mutation<
      { id: string; message: string },
      { testId: string; questionId: string; input: WeightedQuestionInput }
    >({
      query: ({ testId, questionId, input }) => ({
        url: `/api/tests/${encodeURIComponent(testId)}/questions/${encodeURIComponent(questionId)}`,
        method: "PATCH",
        body: input,
      }),
      invalidatesTags: (_result, error, { testId }) =>
        error ? [] : ["TeacherDashboard", { type: "TestEditor", id: testId }],
    }),
    deleteDraftQuestion: builder.mutation<
      null,
      { testId: string; questionId: string }
    >({
      query: ({ testId, questionId }) => ({
        url: `/api/tests/${encodeURIComponent(testId)}/questions/${encodeURIComponent(questionId)}`,
        method: "DELETE",
      }),
      invalidatesTags: (_result, error, { testId }) =>
        error ? [] : ["TeacherDashboard", { type: "TestEditor", id: testId }],
    }),

    // Runner: preserve sequential save locks in the component.
    startRunnerAttempt: builder.mutation<
      { attemptId: string; resumed: boolean },
      string
    >({
      query: (testId) => ({
        url: "/api/attempts/start",
        method: "POST",
        body: { testId },
      }),
    }),
    getRunnerAttempt: builder.query<RunnerState, string>({
      query: (attemptId) => `/api/attempts/${encodeURIComponent(attemptId)}`,
      providesTags: (_result, _error, id) => [{ type: "RunnerAttempt", id }],
      keepUnusedDataFor: 0,
    }),
    saveRunnerAnswer: builder.mutation<
      { questionId: string; optionIds: string[]; savedAt: string },
      { attemptId: string; questionId: string; optionIds: string[] }
    >({
      query: ({ attemptId, questionId, optionIds }) => ({
        url: `/api/attempts/${encodeURIComponent(attemptId)}/answer`,
        method: "PUT",
        body: { questionId, optionIds },
      }),
      // Local optimistic choice is kept by TestRunnerPage; no global full-state refetch per click.
    }),
    finishRunnerAttempt: builder.mutation<RunnerResult, string>({
      query: (attemptId) => ({
        url: `/api/attempts/${encodeURIComponent(attemptId)}/finish`,
        method: "POST",
      }),
      invalidatesTags: (_result, error, attemptId) =>
        error
          ? []
          : [
              "Catalog",
              "StudentDashboard",
              "TeacherDashboard",
              "SubmissionHistory",
              "TestOverview",
              "TeacherStatistics",
              { type: "RunnerAttempt", id: attemptId },
            ],
    }),
  }),
});

export const {
  useGetAdminUsersQuery,
  useGetAdminAuditQuery,
  useChangeUserRoleMutation,
  useGetCatalogQuery,
  useGetTestOverviewQuery,
  useGetStudentDashboardQuery,
  useGetTeacherDashboardQuery,
  useGetTeacherTestsQuery,
  useGetMySubmissionsQuery,
  useGetSubmissionDetailQuery,
  useCreateTestMutation,
  useDeleteTestMutation,
  usePublishTestMutation,
  useGetTestStatisticsQuery,
  useGetTeacherSubmissionDetailsQuery,
  useLazyGetTestSettingsQuery,
  useLazyGetTestVersionsQuery,
  useLazyGetDraftEditorQuery,
  useLazyGetTestDetailsQuery,
  useUpdateTestMetadataMutation,
  useUpdateTestSettingsMutation,
  useCreateDraftRevisionMutation,
  useAddWeightedQuestionMutation,
  useUpdateWeightedQuestionMutation,
  useDeleteDraftQuestionMutation,
  useStartRunnerAttemptMutation,
  useLazyGetRunnerAttemptQuery,
  useSaveRunnerAnswerMutation,
  useFinishRunnerAttemptMutation,
} = evalioApi;
