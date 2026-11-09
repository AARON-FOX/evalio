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
import { TeacherTestsPage } from "./pages/TeacherTestsPage";
import { TestEditorPage } from "./pages/TestEditorPage";

// import { TestBuilder } from "./components/TestBuilder/TestBuilder";
import { StudentTesting } from "./components/StudentTesting/StudentTesting";
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
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />

          {/* Student routes */}
          <Route element={<RoleRoute allowedRole="respondent" />}>
            <Route path="/tests" element={<StudentTesting />} />

            <Route path="/tests/:testId" element={<StudentTesting />} />

            <Route path="/results" element={<StudentResultsPage />} />
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
      </Route>

      <Route path="/reset-password" element={<AuthPage mode="reset" />} />

      {/* Unknown routes */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
