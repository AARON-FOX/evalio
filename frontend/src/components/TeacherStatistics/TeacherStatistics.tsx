import { useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import { getCurrentUser } from "../../services/api";

import {
  getTeacherTests,
  getTestStatistics,
  getSubmissionDetails,
  type TeacherTest,
  type TestStatistics,
  type SubmissionDetails,
} from "../../services/teacherStatisticsApi";

import "./TeacherStatistics.css";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Невідома помилка";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("uk-UA");
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function TeacherStatistics() {
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!authReady) {
    return <p>Перевірка авторизації...</p>;
  }

  if (!userId) {
    return (
      <section className="teacher-statistics">
        <h2>Статистика тестувань</h2>
        <p>Увійди до Evalio, щоб переглянути статистику.</p>
      </section>
    );
  }

  return <StatisticsWorkspace key={userId} userId={userId} />;
}

function StatisticsWorkspace({ userId }: { userId: string }) {
  const [pageState, setPageState] = useState<
    "loading" | "ready" | "forbidden" | "error"
  >("loading");

  const [tests, setTests] = useState<TeacherTest[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [statistics, setStatistics] = useState<TestStatistics | null>(null);

  const [details, setDetails] = useState<SubmissionDetails | null>(null);

  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session || session.user.id !== userId) {
          throw new Error("Authentication required");
        }

        const user = await getCurrentUser(session.access_token);

        if (cancelled) return;

        if (user.role !== "creator") {
          setPageState("forbidden");
          return;
        }

        const response = await getTeacherTests(page);

        if (cancelled) return;

        setTests(response.items);
        setTotal(response.total);
        setPageSize(response.pageSize);
        setPageState("ready");
      } catch (err) {
        if (!cancelled) {
          setError(errorText(err));
          setPageState("error");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [userId, page]);

  function changePage(nextPage: number) {
    setPageState("loading");
    setStatistics(null);
    setDetails(null);
    setError("");
    setPage(nextPage);
  }

  async function openStatistics(testId: string) {
    if (working) return;

    setWorking(true);
    setError("");
    setStatistics(null);
    setDetails(null);

    try {
      const result = await getTestStatistics(testId);
      setStatistics(result);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setWorking(false);
    }
  }

  async function openSubmission(submissionId: string) {
    if (!statistics || working) return;

    setWorking(true);
    setError("");
    setDetails(null);

    try {
      const result = await getSubmissionDetails(
        statistics.testId,
        submissionId,
      );

      setDetails(result);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setWorking(false);
    }
  }

  if (pageState === "loading") {
    return <p>Завантаження статистики...</p>;
  }

  if (pageState === "forbidden") {
    return (
      <section className="teacher-statistics">
        <h2>Статистика тестувань</h2>
        <p>Цей розділ доступний лише викладачам.</p>
      </section>
    );
  }

  if (pageState === "error") {
    return (
      <section className="teacher-statistics">
        <h2>Помилка завантаження</h2>
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
              onClick={() => void openStatistics(test.id)}
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
                            <td>{shortId(attempt.respondentId)}</td>

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
                                onClick={() => void openSubmission(attempt.id)}
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
                <button type="button" onClick={() => setDetails(null)}>
                  Закрити
                </button>
              </div>

              <p>Студент: {shortId(details.respondentId)}</p>

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
