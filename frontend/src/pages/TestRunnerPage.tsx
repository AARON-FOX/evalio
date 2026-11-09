import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ShieldCheck,
} from "lucide-react";

import { Alert } from "../components/ui/Alert/Alert";
import { Button } from "../components/ui/Button/Button";
import { Card } from "../components/ui/Card/Card";
import { Choice } from "../components/ui/Choice/Choice";
import {
  startRunnerAttempt,
  getRunnerAttempt,
  saveRunnerAnswer,
  finishRunnerAttempt,
  type RunnerResult,
  type RunnerState,
} from "../services/activeAttemptsApi";
import styles from "./TestRunnerPage.module.scss";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Не вдалося виконати запит.";
}

function timeText(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TestRunnerPage() {
  const { testId } = useParams();
  const [attempt, setAttempt] = useState<RunnerState | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");
  const saveLock = useRef(false);
  const finishLock = useRef(false);

  useEffect(() => {
    let current = true;
    if (!testId) return;
    void (async () => {
      try {
        const { attemptId } = await startRunnerAttempt(testId);
        const result = await getRunnerAttempt(attemptId);
        if (!current) return;
        setAttempt(result);
        setNow(Date.now());
        if (result.status === "active") {
          setAnswers(result.answers);
          setClockOffset(Date.parse(result.serverNow) - Date.now());
        }
      } catch (cause) {
        if (current) setError(errorText(cause));
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [testId]);

  const active = attempt?.status === "active" ? attempt : null;
  const questions = active?.questions ?? [];
  const question = questions[index];
  const answeredCount = questions.filter(
    (q) => (answers[q.id] ?? []).length > 0,
  ).length;
  const remainingMs =
    active?.expiresAt && now > 0
      ? Math.max(0, Date.parse(active.expiresAt) - (now + clockOffset))
      : null;

  const finish = useCallback(async () => {
    if (
      !attempt ||
      attempt.status !== "active" ||
      finishLock.current ||
      saveLock.current
    )
      return;
    finishLock.current = true;
    setFinishing(true);
    setError("");
    try {
      const result: RunnerResult = await finishRunnerAttempt(attempt.id);
      setAttempt({
        id: attempt.id,
        status: "submitted",
        testId: attempt.testId,
        title: attempt.title,
        result,
      });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      finishLock.current = false;
      setFinishing(false);
    }
  }, [attempt]);

  useEffect(() => {
    if (!active) return;

    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);

      if (
        active.expiresAt &&
        Date.parse(active.expiresAt) <= currentTime + clockOffset &&
        !saveLock.current &&
        !finishLock.current
      ) {
        void finish();
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [active, clockOffset, finish]);

  async function changeAnswer(optionId: string | null) {
    if (!active || !question || saveLock.current || finishLock.current) return;
    const before = answers[question.id] ?? [];
    const next =
      optionId === null
        ? []
        : question.questionType === "single_choice"
          ? [optionId]
          : before.includes(optionId)
            ? before.filter((item) => item !== optionId)
            : [...before, optionId];
    saveLock.current = true;
    setSaving(true);
    setError("");
    setAnswers((prev) => ({ ...prev, [question.id]: next }));
    try {
      await saveRunnerAnswer(active.id, question.id, next);
    } catch (cause) {
      setAnswers((prev) => ({ ...prev, [question.id]: before }));
      setError(errorText(cause));
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  function confirmFinish() {
    const missing = questions.length - answeredCount;
    const message =
      missing > 0
        ? `Залишилося ${missing} запитань без відповіді. Завершити тест?`
        : "Завершити тест? Після цього відповіді змінити не можна.";
    if (window.confirm(message)) void finish();
  }

  if (loading)
    return <div className={styles.loading}>Завантаження спроби…</div>;
  if (!attempt) {
    return (
      <div className={styles.loading}>
        <Alert tone="error" title="Не вдалося почати тест">
          {error || "Спроба недоступна."}
        </Alert>
        <Link to="/tests">Повернутися до тестів</Link>
      </div>
    );
  }

  if (attempt.status === "submitted") {
    const result = attempt.result;
    return (
      <div className={styles.finished}>
        <Card elevated>
          <CheckCircle2
            size={44}
            color="var(--color-success-text)"
            aria-hidden="true"
          />
          <h1>Тест завершено</h1>
          <p>{attempt.title}</p>
          {result.kind === "survey" ? (
            <Alert tone="success">Відповіді на опитування збережено.</Alert>
          ) : result.resultVisible ? (
            <div className={styles.resultScore}>
              {result.score} / {result.maxScore} балів
            </div>
          ) : (
            <Alert tone="info">
              Відповіді збережено. Оцінка поки недоступна.
            </Alert>
          )}
          {result.reason === "timeout" && (
            <p>
              Час завершився. Сервер автоматично зафіксував наявні відповіді.
            </p>
          )}
          <Link to={`/results/${result.id}`} className={styles.resultLink}>
            Переглянути результат
          </Link>
          <Link to="/results" className={styles.backLink}>
            Усі результати
          </Link>

          <Link to="/dashboard" className={styles.backLink}>
            До кабінету
          </Link>
        </Card>
      </div>
    );
  }

  if (!active) return <Alert tone="error">Спроба недоступна.</Alert>;
  if (!question) return <Alert tone="error">У тесті немає питань.</Alert>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/dashboard" className={styles.brand}>
          <span>e</span> evalio
        </Link>
        <span className={styles.sessionLabel}>Активна спроба</span>
      </header>

      <main className={styles.content}>
        <Link className={styles.backLink} to="/dashboard">
          <ArrowLeft size={16} /> До кабінету
        </Link>
        <p className={styles.eyebrow}>
          {[active.subject, active.classGroup].filter(Boolean).join(" · ") ||
            "НАВЧАЛЬНИЙ ПРОСТІР"}
        </p>
        <h1>{active.title}</h1>
        {active.description && (
          <p className={styles.subtitle}>{active.description}</p>
        )}

        <Card className={styles.progressCard}>
          <div className={styles.progressTop}>
            <div>
              <strong>
                Запитання {index + 1} з {questions.length}
              </strong>
              <small>Збережено відповідей: {answeredCount}</small>
            </div>
            <div className={styles.clock}>
              <Clock3 size={19} aria-hidden="true" />
              <div>
                <small>Залишилося</small>
                <strong>
                  {remainingMs === null ? "Без ліміту" : timeText(remainingMs)}
                </strong>
              </div>
            </div>
          </div>
          <div
            className={styles.track}
            role="progressbar"
            aria-valuenow={index + 1}
            aria-valuemin={1}
            aria-valuemax={questions.length}
            aria-label="Поточне запитання"
          >
            <div
              style={{ width: `${((index + 1) / questions.length) * 100}%` }}
            />
          </div>
        </Card>

        {error && (
          <Alert tone="error" title="Помилка">
            {error}
          </Alert>
        )}
        <div className={styles.columns}>
          <Card className={styles.questionCard}>
            <div className={styles.questionMeta}>
              <span>
                {question.questionType === "single_choice"
                  ? "ОДНА ПРАВИЛЬНА ВІДПОВІДЬ"
                  : "ДЕКІЛЬКА ПРАВИЛЬНИХ ВІДПОВІДЕЙ"}
              </span>
              {active.kind === "test" && <span>{question.points} балів</span>}
            </div>
            <h2>{question.text}</h2>
            <p className={styles.instruction}>
              {question.questionType === "single_choice"
                ? "Оберіть один варіант відповіді."
                : "Оберіть усі потрібні варіанти."}
            </p>
            <div className={styles.options}>
              {question.options.map((option) => (
                <Choice
                  key={option.id}
                  type={
                    question.questionType === "single_choice"
                      ? "radio"
                      : "checkbox"
                  }
                  name={`answer-${question.id}`}
                  label={option.text}
                  checked={(answers[question.id] ?? []).includes(option.id)}
                  disabled={saving || finishing || remainingMs === 0}
                  onChange={() => void changeAnswer(option.id)}
                />
              ))}
            </div>
            <div className={styles.saveStatus} aria-live="polite">
              {saving
                ? "Зберігаємо відповідь…"
                : (answers[question.id] ?? []).length > 0
                  ? "Відповідь збережено на сервері"
                  : "Ще немає відповіді. Вибір збережеться автоматично."}
              {(answers[question.id] ?? []).length > 0 && !saving && (
                <button type="button" onClick={() => void changeAnswer(null)}>
                  Очистити відповідь
                </button>
              )}
            </div>
            <div className={styles.actions}>
              <Button
                variant="outline"
                disabled={index === 0 || saving || finishing}
                onClick={() => setIndex((prev) => prev - 1)}
              >
                <ArrowLeft size={16} /> Назад
              </Button>
              <Button
                disabled={index === questions.length - 1 || saving || finishing}
                onClick={() => setIndex((prev) => prev + 1)}
              >
                Далі <ArrowRight size={16} />
              </Button>
            </div>
          </Card>
          <Card className={styles.sidebar}>
            <h2>Ваш прогрес</h2>
            <div className={styles.questionIndex}>
              {questions.map((item, itemIndex) => {
                const answered = (answers[item.id] ?? []).length > 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={saving || finishing}
                    aria-current={itemIndex === index ? "step" : undefined}
                    aria-label={`Запитання ${itemIndex + 1}${answered ? ", відповідь збережена" : ""}`}
                    className={
                      itemIndex === index
                        ? styles.current
                        : answered
                          ? styles.answered
                          : ""
                    }
                    onClick={() => setIndex(itemIndex)}
                  >
                    {itemIndex + 1}
                  </button>
                );
              })}
            </div>
            <div className={styles.legend}>
              <span>
                <i className={styles.solid} /> Відповідь збережено
              </span>
              <span>
                <i className={styles.outline} /> Поточне запитання
              </span>
              <span>
                <i className={styles.empty} /> Ще без відповіді
              </span>
            </div>
            <p>
              Можна повертатися до питань і змінювати відповіді до завершення.
            </p>
            <Button
              variant="outline"
              fullWidth
              disabled={saving || finishing}
              onClick={confirmFinish}
            >
              {finishing ? "Завершуємо…" : "Завершити тест"}
            </Button>
            <small>Після завершення відповіді змінити не можна.</small>
          </Card>
        </div>
        <footer className={styles.note}>
          <ShieldCheck size={17} aria-hidden="true" />
          Після закінчення часу сервер завершить спробу при наступному запиті.
        </footer>
      </main>
    </div>
  );
}
