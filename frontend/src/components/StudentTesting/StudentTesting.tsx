import { useEffect, useRef, useState } from "react";

import { supabase } from "../../lib/supabase";
import { getCurrentUser } from "../../services/api";

import {
  getTests,
  getTestDetails,
  type TestDetails,
  type TestRecord,
  type TestQuestion,
} from "../../services/testsApi";

import {
  getMySubmissions,
  submitTest,
  type SubmissionHistory,
  type SubmissionResult,
} from "../../services/submissionsApi";

import "./StudentTesting.css";

type Answers = Record<string, string[]>;

type PageState = "loading" | "ready" | "forbidden" | "error";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Невідома помилка";
}

export function StudentTesting() {
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const previousUserId = useRef<string | null | undefined>(undefined);

  const [pageState, setPageState] = useState<PageState>("loading");

  const [tests, setTests] = useState<TestRecord[]>([]);
  const [history, setHistory] = useState<SubmissionHistory[]>([]);

  const [selected, setSelected] = useState<TestDetails | null>(null);

  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<SubmissionResult | null>(null);

  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  // Track authentication changes
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user.id ?? null;

      if (previousUserId.current !== nextId) {
        previousUserId.current = nextId;

        setTests([]);
        setHistory([]);
        setSelected(null);
        setAnswers({});
        setResult(null);
        setError("");
        setPageState("loading");
      }

      setUserId(nextId);
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load student data
  useEffect(() => {
    if (!authReady || !userId) return;

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

        if (user.role !== "respondent") {
          setPageState("forbidden");
          return;
        }

        const [available, previous] = await Promise.all([
          getTests(),
          getMySubmissions(),
        ]);

        if (cancelled) return;

        setTests(available.filter((test) => test.status === "published"));
        setHistory(previous);
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
  }, [authReady, userId]);

  async function openTest(id: string) {
    setWorking(true);
    setError("");

    try {
      const details = await getTestDetails(id);

      if (details.status !== "published") {
        throw new Error("Тест ще не опубліковано.");
      }

      setSelected(details);
      setAnswers({});
      setResult(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setWorking(false);
    }
  }

  function changeAnswer(question: TestQuestion, optionId: string) {
    setAnswers((current) => {
      const existing = current[question.id] ?? [];

      const next =
        question.question_type === "single_choice"
          ? [optionId]
          : existing.includes(optionId)
            ? existing.filter((id) => id !== optionId)
            : [...existing, optionId];

      return {
        ...current,
        [question.id]: next,
      };
    });
  }

  const allAnswered =
    selected !== null &&
    selected.questions.length > 0 &&
    selected.questions.every((question) => {
      const chosen = answers[question.id] ?? [];

      return question.question_type === "single_choice"
        ? chosen.length === 1
        : chosen.length >= 1;
    });

  async function handleSubmit() {
    if (!selected || !allAnswered || working || result) {
      return;
    }

    setWorking(true);
    setError("");

    try {
      const payload = selected.questions.map((question) => ({
        questionId: question.id,
        optionIds: answers[question.id] ?? [],
      }));

      const saved = await submitTest(selected.id, payload);

      setResult(saved);

      // Submission is already saved; a history refresh
      // failure must not invalidate the saved result.
      try {
        setHistory(await getMySubmissions());
      } catch (historyError) {
        console.error("History refresh failed:", historyError);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setWorking(false);
    }
  }

  if (!authReady) {
    return <p>Перевірка авторизації...</p>;
  }

  if (!userId) {
    return (
      <section className="student-testing">
        <h2>Проходження тестів</h2>
        <p>Увійди до Evalio, щоб переглядати тести.</p>
      </section>
    );
  }

  if (pageState === "loading") {
    return <p>Завантаження тестів...</p>;
  }

  if (pageState === "forbidden") {
    return (
      <section className="student-testing">
        <h2>Проходження тестів</h2>
        <p>Цей розділ доступний ролі respondent.</p>
      </section>
    );
  }

  if (pageState === "error") {
    return (
      <section className="student-testing">
        <h2>Помилка завантаження</h2>
        <p role="alert">{error}</p>
      </section>
    );
  }

  return (
    <section className="student-testing">
      <header className="st-header">
        <h2>Проходження тестів</h2>
        <p>Перевір свої знання на платформі Evalio</p>
      </header>

      {error && (
        <p className="st-error" role="alert">
          {error}
        </p>
      )}

      <div className="st-layout">
        <aside className="st-sidebar">
          <h3>Доступні тести</h3>

          {tests.length === 0 && <p>Опублікованих тестів поки немає.</p>}

          {tests.map((test) => (
            <button
              key={test.id}
              type="button"
              disabled={working}
              onClick={() => void openTest(test.id)}
              className={selected?.id === test.id ? "active" : ""}
            >
              <strong>{test.title}</strong>
              <small>{test.kind === "test" ? "Тест" : "Опитування"}</small>
            </button>
          ))}
        </aside>

        <div className="st-content">
          {!selected && (
            <div className="st-panel">
              <h3>Вибери тест зі списку</h3>
              <p>Після вибору тут з'являться питання та варіанти відповідей.</p>
            </div>
          )}

          {selected && (
            <div className="st-panel">
              <h3>{selected.title}</h3>

              {selected.description && <p>{selected.description}</p>}

              <p>
                {selected.kind === "test"
                  ? "Тест з оцінюванням"
                  : "Опитування без оцінювання"}
                {" · "}
                {selected.questions.length} питань
              </p>

              {selected.questions.map((question) => (
                <div key={question.id} className="st-question">
                  <h4>
                    {question.position}. {question.text}
                  </h4>

                  <p className="st-hint">
                    {question.question_type === "single_choice"
                      ? "Вибери одну відповідь"
                      : "Можна вибрати кілька відповідей"}
                  </p>

                  {question.options.map((option) => (
                    <label key={option.id} className="st-option">
                      <input
                        type={
                          question.question_type === "single_choice"
                            ? "radio"
                            : "checkbox"
                        }
                        name={`question-${question.id}`}
                        checked={
                          answers[question.id]?.includes(option.id) ?? false
                        }
                        disabled={working || !!result}
                        onChange={() => changeAnswer(question, option.id)}
                      />
                      <span>{option.text}</span>
                    </label>
                  ))}
                </div>
              ))}

              {!result ? (
                <button
                  type="button"
                  className="st-primary"
                  disabled={!allAnswered || working}
                  onClick={() => void handleSubmit()}
                >
                  {working ? "Надсилання..." : "Завершити проходження"}
                </button>
              ) : (
                <div className="st-result" role="status">
                  <h3>Проходження завершено</h3>

                  {result.score !== null && result.maxScore !== null ? (
                    <p className="st-score">
                      {result.score} / {result.maxScore}
                    </p>
                  ) : (
                    <p>Відповіді на опитування збережено.</p>
                  )}

                  <p>Результат збережений у Supabase.</p>

                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setAnswers({});
                      setResult(null);
                    }}
                  >
                    Повернутися до списку
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="st-panel st-history">
        <h3>Мої результати</h3>

        {history.length === 0 ? (
          <p>Поки немає завершених проходжень.</p>
        ) : (
          <div className="st-history-list">
            {history.map((submission) => {
              const test = tests.find((item) => item.id === submission.test_id);

              return (
                <div className="st-history-item" key={submission.id}>
                  <div>
                    <strong>{test?.title ?? "Тест"}</strong>
                    <small>
                      {new Date(submission.submitted_at).toLocaleString(
                        "uk-UA",
                      )}
                    </small>
                  </div>

                  <strong>
                    {submission.score !== null && submission.max_score !== null
                      ? `${submission.score} / ${submission.max_score}`
                      : "Опитування"}
                  </strong>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
