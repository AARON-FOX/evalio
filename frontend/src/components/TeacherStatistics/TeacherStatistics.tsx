import { useState } from "react";
import {
  useGetTeacherTestsQuery,
  useGetTestStatisticsQuery,
  useGetTeacherSubmissionDetailsQuery,
} from "../../app/evalioApi";
import { queryErrorMessage } from "../../app/queryError";
import { useAuth } from "../../context/useAuth";
import "./TeacherStatistics.css";

function formatDate(value: string): string {
  return new Date(value).toLocaleString("uk-UA");
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// Auth and creator role are enforced by ProtectedRoute + RoleRoute in App.tsx.
// All reads go through the shared RTK Query API and the Express role checks.
export function TeacherStatistics() {
  const { session } = useAuth();
  // Remount page-local selection when account changes.
  return <StatisticsWorkspace key={session?.user.id ?? "guest"} />;
}

function StatisticsWorkspace() {
  const [page, setPage] = useState(1);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<
    string | null
  >(null);

  const testsQuery = useGetTeacherTestsQuery(page);
  const statisticsQuery = useGetTestStatisticsQuery(selectedTestId ?? "", {
    skip: !selectedTestId,
  });
  const detailsQuery = useGetTeacherSubmissionDetailsQuery(
    {
      testId: selectedTestId ?? "",
      submissionId: selectedSubmissionId ?? "",
    },
    { skip: !selectedTestId || !selectedSubmissionId },
  );

  const tests = testsQuery.currentData?.items ?? [];
  const total = testsQuery.currentData?.total ?? 0;
  const pageSize = testsQuery.currentData?.pageSize ?? 20;
  const statistics = selectedTestId
    ? (statisticsQuery.currentData ?? null)
    : null;
  const details = selectedSubmissionId
    ? (detailsQuery.currentData ?? null)
    : null;
  const working = statisticsQuery.isFetching || detailsQuery.isFetching;
  const errorValue =
    testsQuery.error ?? statisticsQuery.error ?? detailsQuery.error;
  const error = errorValue ? queryErrorMessage(errorValue) : "";

  function changePage(nextPage: number) {
    setSelectedTestId(null);
    setSelectedSubmissionId(null);
    setPage(nextPage);
  }

  function openStatistics(testId: string) {
    setSelectedSubmissionId(null);
    setSelectedTestId(testId);
  }

  function openSubmission(submissionId: string) {
    if (!selectedTestId) return;
    setSelectedSubmissionId(submissionId);
  }

  if (testsQuery.isLoading) return <p>Завантаження статистики...</p>;
  if (testsQuery.isError && !testsQuery.data) {
    return (
      <section className="teacher-statistics">
        <h2>Не вдалося отримати статистику</h2>
        <p role="alert">{error}</p>
      </section>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="teacher-statistics">
      <header className="ts-header">
        <h2>Статистика тестувань</h2>
        <p>Результати та активність студентів</p>
      </header>

      {error && (
        <p className="ts-error" role="alert">
          {error}
        </p>
      )}

      <div className="ts-layout">
        <aside className="ts-sidebar">
          <h3>Мої тести</h3>

          {tests.length === 0 && <p>Тестів поки немає.</p>}

          {tests.map((test) => (
            <button
              type="button"
              key={test.id}
              disabled={working}
              className={
                statistics?.testId === test.id ? "ts-test active" : "ts-test"
              }
              onClick={() => openStatistics(test.id)}
            >
              <strong>{test.title}</strong>
              <small>
                {test.kind === "test" ? "Тест" : "Опитування"}
                {" · "}
                {test.status === "published" ? "Опубліковано" : "Чернетка"}
              </small>
            </button>
          ))}

          <div className="ts-pagination">
            <button
              type="button"
              disabled={working || page <= 1}
              onClick={() => changePage(page - 1)}
            >
              ‹
            </button>

            <span>
              {page} / {totalPages}
            </span>

            <button
              type="button"
              disabled={working || page >= totalPages}
              onClick={() => changePage(page + 1)}
            >
              ›
            </button>
          </div>
        </aside>

        <div className="ts-main">
          {!statistics && (
            <div className="ts-panel">
              <h3>Вибери тест</h3>
              <p>Відкрий тест зі списку, щоб побачити статистику проходжень.</p>
              {working && <p>Завантаження...</p>}
            </div>
          )}

          {statistics && (
            <>
              <div className="ts-panel">
                <h3>{statistics.title}</h3>

                <p>
                  {statistics.kind === "test"
                    ? "Тест з оцінюванням"
                    : "Опитування"}
                </p>

                <div className="ts-metrics">
                  <div className="ts-metric">
                    <span>Усього спроб</span>
                    <strong>{statistics.totalAttempts}</strong>
                  </div>

                  <div className="ts-metric">
                    <span>Унікальних студентів</span>
                    <strong>{statistics.uniqueRespondents}</strong>
                  </div>

                  <div className="ts-metric">
                    <span>Середній бал</span>
                    <strong>{statistics.averageScore ?? "—"}</strong>
                  </div>

                  <div className="ts-metric">
                    <span>Середній результат</span>
                    <strong>
                      {statistics.averagePercent !== null
                        ? `${statistics.averagePercent}%`
                        : "—"}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="ts-panel">
                <h3>Останні проходження</h3>

                {statistics.recentSubmissions.length === 0 ? (
                  <p>Цей тест ще ніхто не проходив.</p>
                ) : (
                  <div className="ts-table-wrap">
                    <table className="ts-table">
                      <thead>
                        <tr>
                          <th>Студент</th>
                          <th>Дата</th>
                          <th>Результат</th>
                          <th>Дії</th>
                        </tr>
                      </thead>

                      <tbody>
                        {statistics.recentSubmissions.map((attempt) => (
                          <tr key={attempt.id}>
                            <td>
                              {attempt.respondentEmail ||
                                `Учасник ${shortId(attempt.respondentId)}`}
                            </td>

                            <td>{formatDate(attempt.submittedAt)}</td>

                            <td>
                              {attempt.score !== null &&
                              attempt.maxScore !== null
                                ? `${attempt.score} / ${attempt.maxScore}`
                                : "Опитування"}
                            </td>

                            <td>
                              <button
                                type="button"
                                disabled={working}
                                onClick={() => openSubmission(attempt.id)}
                              >
                                Переглянути
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <p className="ts-hint">
                  Показано максимум 20 останніх спроб. Загальні показники
                  враховують усі проходження.
                </p>
              </div>
            </>
          )}

          {details && (
            <div className="ts-panel">
              <div className="ts-details-heading">
                <h3>Деталі проходження</h3>
                <button
                  type="button"
                  onClick={() => setSelectedSubmissionId(null)}
                >
                  Закрити
                </button>
              </div>

              <p>
                Студент:{" "}
                {details.respondentEmail ||
                  `Учасник ${shortId(details.respondentId)}`}
              </p>

              <p>Дата: {formatDate(details.submittedAt)}</p>

              {details.score !== null && details.maxScore !== null && (
                <p>
                  Результат: {details.score} / {details.maxScore}
                </p>
              )}

              {details.questions.map((question, index) => (
                <div className="ts-question" key={question.questionId}>
                  <h4>
                    {index + 1}. {question.text}
                  </h4>

                  {question.isCorrect !== null && (
                    <p
                      className={
                        question.isCorrect ? "ts-correct" : "ts-incorrect"
                      }
                    >
                      {question.isCorrect ? "Правильно" : "Неправильно"}
                    </p>
                  )}

                  <p>Вибрані варіанти:</p>

                  <ul>
                    {question.selectedOptions.map((option) => (
                      <li key={option.id}>{option.text}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
