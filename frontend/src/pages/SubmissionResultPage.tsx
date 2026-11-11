import type { CSSProperties } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  Info,
  Lightbulb,
  ShieldCheck,
  X,
  CircleMinus,
} from "lucide-react";

import { Alert } from "../components/ui/Alert/Alert";
import { Card } from "../components/ui/Card/Card";
import type { ReviewedQuestion } from "../services/submissionResultApi";
import { useGetSubmissionDetailQuery } from "../app/evalioApi";
import { queryErrorMessage } from "../app/queryError";
import styles from "./SubmissionResultPage.module.scss";

function formatDate(date: string) {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function pointsLabel(value: number) {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "балів";
  return last === 1 ? "бал" : last >= 2 && last <= 4 ? "бали" : "балів";
}

function AnswerReview({
  question,
  index,
}: {
  question: ReviewedQuestion;
  index: number;
}) {
  const positive = question.status === "correct";
  const skipped = question.status === "unanswered";
  return (
    <Card className={styles.reviewCard}>
      <div className={styles.questionTop}>
        <span
          className={[
            styles.state,
            positive
              ? styles.stateCorrect
              : skipped
                ? styles.stateSkipped
                : styles.stateIncorrect,
          ].join(" ")}
        >
          {positive ? (
            <Check size={14} />
          ) : skipped ? (
            <CircleMinus size={14} />
          ) : (
            <X size={14} />
          )}
          {positive ? "Правильно" : skipped ? "Без відповіді" : "Неправильно"}
        </span>
        <span className={styles.earnedPoints}>
          {question.earnedPoints} / {question.points}{" "}
          {pointsLabel(question.points)}
        </span>
      </div>

      <h3>
        {index + 1}. {question.text}
      </h3>

      {question.selectedOptions.length > 0 ? (
        <div
          className={[
            styles.answerBox,
            positive ? styles.answerCorrect : styles.answerWrong,
          ].join(" ")}
        >
          <span className={styles.answerLabel}>
            {positive ? <Check size={14} /> : <X size={14} />} ВАША ВІДПОВІДЬ
          </span>
          {question.selectedOptions.map((answer) => (
            <p key={answer.id}>{answer.text}</p>
          ))}
        </div>
      ) : (
        <div className={`${styles.answerBox} ${styles.answerEmpty}`}>
          <span className={styles.answerLabel}>ВАША ВІДПОВІДЬ</span>
          <p>Питання залишено без відповіді.</p>
        </div>
      )}

      {!positive && question.correctOptions.length > 0 && (
        <div className={`${styles.answerBox} ${styles.answerCorrect}`}>
          <span className={styles.answerLabel}>
            <Check size={14} /> ПРАВИЛЬНА ВІДПОВІДЬ
          </span>
          {question.correctOptions.map((answer) => (
            <p key={answer.id}>{answer.text}</p>
          ))}
        </div>
      )}

      {question.explanation && (
        <p className={styles.explanation}>{question.explanation}</p>
      )}
    </Card>
  );
}

export function SubmissionResultPage() {
  const { submissionId } = useParams();
  const {
    data: result,
    isLoading: loading,
    error: queryError,
  } = useGetSubmissionDetailQuery(submissionId ?? "", { skip: !submissionId });
  const error = queryError ? queryErrorMessage(queryError) : "";

  if (!submissionId)
    return <Alert tone="error">Не вказано ідентифікатор результату.</Alert>;
  if (loading)
    return <p className={styles.loading}>Завантаження результату…</p>;
  if (error || !result) {
    return (
      <div className={styles.page}>
        <Alert tone="error" title="Не вдалося відкрити результат">
          {error || "Результат недоступний."}
        </Alert>
        <Link to="/results" className={styles.backLink}>
          <ArrowLeft size={16} /> До історії результатів
        </Link>
      </div>
    );
  }

  const percent =
    result.resultVisible &&
    result.score !== null &&
    result.maxScore !== null &&
    result.maxScore > 0
      ? Math.round((result.score / result.maxScore) * 100)
      : null;
  const needsReview = result.questions.find(
    (q) => q.status !== "correct" && Boolean(q.explanation),
  );
  const hasMistakes = result.questions.some((q) => q.status !== "correct");
  const isSurvey = result.kind === "survey";

  return (
    <section className={styles.page}>
      <Link to="/results" className={styles.backLink}>
        <ArrowLeft size={16} /> До результатів
      </Link>

      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>
            РЕЗУЛЬТАТИ{" "}
            {result.subject ? `· ${result.subject.toUpperCase()}` : ""}
          </p>
          <h1>{isSurvey ? "Опитування завершено" : "Тест завершено"}</h1>
          <p className={styles.meta}>
            {result.testTitle}
            {result.classGroup ? ` · ${result.classGroup}` : ""}
            {` · Версія ${result.versionNumber}`}
          </p>
        </div>

        <Link to="/dashboard" className={styles.headingLink}>
          <ArrowLeft size={16} /> До кабінету
        </Link>
      </div>

      <Card className={styles.hero}>
        <div className={styles.heroMain}>
          {percent !== null ? (
            <div
              className={styles.scoreRing}
              role="img"
              aria-label={`Результат ${result.score} із ${result.maxScore} балів, ${percent} відсотків`}
              style={
                {
                  "--score-progress": `${Math.min(100, Math.max(0, percent))}%`,
                } as CSSProperties
              }
            >
              <div className={styles.scoreRingInner}>
                <strong>
                  {result.score} / {result.maxScore}
                </strong>
                <small>балів · {percent}%</small>
              </div>
            </div>
          ) : (
            <div className={styles.hiddenRing} aria-hidden="true">
              <ShieldCheck size={34} />
            </div>
          )}

          <div className={styles.heroText}>
            <span className={styles.completedBadge}>
              <CheckCircle2 size={14} /> Завершено
              {percent !== null ? ` · ${percent}%` : ""}
            </span>
            <h2>
              {isSurvey
                ? "Дякуємо за відповіді!"
                : result.resultVisible
                  ? "Гарна робота!"
                  : "Відповіді збережено!"}
            </h2>
            <p>
              {isSurvey
                ? "Ваші відповіді на опитування збережені."
                : !result.resultVisible
                  ? "Показ оцінки вимкнено в налаштуваннях цього тесту."
                  : result.reviewVisible
                    ? `Тест містить ${result.totalQuestions} запитань. Нижче можна переглянути відповіді та пояснення.`
                    : "Оцінка доступна. Розбір правильних відповідей вимкнений викладачем."}
            </p>
            <span className={styles.dateLine}>
              {formatDate(result.submittedAt)}
              {result.finishReason === "timeout"
                ? " · Завершено за таймером"
                : ""}
            </span>
          </div>
        </div>

        <div className={styles.metrics}>
          <div>
            <strong className={styles.positive}>
              {result.correctCount ?? "—"}
            </strong>
            <span>Правильні</span>
          </div>
          <div>
            <strong className={styles.negative}>
              {result.incorrectCount ?? "—"}
            </strong>
            <span>Неправильні</span>
          </div>
          <div>
            <strong>{result.unansweredCount ?? "—"}</strong>
            <span>Без відповіді</span>
          </div>
          <div>
            <strong>{formatDuration(result.durationSeconds)}</strong>
            <span>Час проходження</span>
          </div>
        </div>
        {!result.reviewVisible && (
          <p className={styles.metricsNote}>
            Показники правильних і неправильних відповідей доступні, лише коли
            викладач дозволив розбір.
          </p>
        )}
      </Card>

      {result.reviewVisible ? (
        <>
          <div className={styles.sectionTitle}>
            <h2>Розбір відповідей</h2>
            <span>{result.totalQuestions} запитань</span>
          </div>
          <div className={styles.columns}>
            <div className={styles.reviewList}>
              {result.questions.map((question, index) => (
                <AnswerReview
                  key={question.id}
                  question={question}
                  index={index}
                />
              ))}
            </div>
            <aside className={styles.sideColumn}>
              <Card className={styles.sideCard}>
                <BookOpen size={20} aria-hidden="true" />
                <h3>Що повторити</h3>
                {needsReview ? (
                  <>
                    <strong>{needsReview.text}</strong>
                    <p>{needsReview.explanation}</p>
                  </>
                ) : (
                  <p>
                    {hasMistakes
                      ? "У тесті були неправильні або пропущені відповіді, але пояснення до них не додано."
                      : "Немає неправильних або пропущених відповідей."}
                  </p>
                )}
              </Card>
              <Card className={`${styles.sideCard} ${styles.sideInfo}`}>
                <ShieldCheck size={20} aria-hidden="true" />
                <h3>Результат збережено</h3>
                <p>
                  Викладач може переглянути ваше проходження та підсумковий бал.
                </p>
              </Card>
            </aside>
          </div>
        </>
      ) : (
        <Card className={styles.notAvailable}>
          <Info size={22} aria-hidden="true" />
          <div>
            <h2>Розбір відповідей недоступний</h2>
            <p>
              {isSurvey
                ? "Відповіді на опитування успішно надіслано."
                : !result.resultVisible
                  ? "Оцінка й правильні відповіді наразі приховані налаштуваннями тесту."
                  : "Викладач вимкнув показ правильних відповідей і пояснень."}
            </p>
          </div>
        </Card>
      )}

      {result.reviewVisible && (
        <div className={styles.tip}>
          <Lightbulb size={19} aria-hidden="true" />
          Поверніться до пояснень, щоб повторити матеріал перед наступним
          завданням.
        </div>
      )}
      <Link className={styles.primaryLink} to="/dashboard">
        <ArrowLeft size={17} /> Повернутися до кабінету
      </Link>
    </section>
  );
}
