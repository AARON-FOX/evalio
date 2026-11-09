import { Navigate, Route, Routes } from "react-router";

import { GuestRoute } from "./routes/GuestRoute";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { RoleRoute } from "./routes/RoleRoute";

import { AppLayout } from "./layouts/AppLayout";

import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { UiKitPage } from "./pages/UiKitPage";
import { StudentResultsPage } from "./pages/StudentResultsPage";
import { SubmissionResultPage } from './pages/SubmissionResultPage';
import { TeacherTestsPage } from "./pages/TeacherTestsPage";
import { TestEditorPage } from "./pages/TestEditorPage";
import { StudentTestsPage } from "./pages/StudentTestsPage";
import { TestRunnerPage } from "./pages/TestRunnerPage";

import { TeacherStatistics } from "./components/TeacherStatistics/TeacherStatistics";

import "./App.css";

function App() {
  return (
    <Routes>
      {/* Default route */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Public routes */}
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
      </Route>

      {/* Authenticated routes */}
      <Route element={<ProtectedRoute />}>
        {/* Main application layout */}
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />

          {/* Student routes */}
          <Route element={<RoleRoute allowedRole="respondent" />}>
            <Route path="/tests" element={<StudentTestsPage />} />
            
            <Route path="/results" element={<StudentResultsPage />} />
            <Route path="/results/:submissionId" element={<SubmissionResultPage />} />
          </Route>

          {/* Teacher routes */}
          <Route element={<RoleRoute allowedRole="creator" />}>
            <Route path="/teacher/tests" element={<TeacherTestsPage />} />
            <Route path="/teacher/tests/new" element={<TestEditorPage />} />
            <Route
              path="/teacher/tests/:testId/edit"
              element={<TestEditorPage />}
            />
            <Route path="/teacher/statistics" element={<TeacherStatistics />} />
          </Route>

          <Route path="/ui-kit" element={<UiKitPage />} />
        </Route>

        {/* Test Runner without AppLayout */}
        <Route element={<RoleRoute allowedRole="respondent" />}>
          <Route path="/tests/:testId" element={<TestRunnerPage />} />
        </Route>
      </Route>

      {/* Password recovery */}
      <Route path="/reset-password" element={<AuthPage mode="reset" />} />

      {/* Unknown routes */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
