import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  Clock3,
  RotateCcw,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { useGetTestOverviewQuery } from "../app/evalioApi";
import { queryErrorMessage } from "../app/queryError";
import { Card } from "../components/ui/Card/Card";
import { Alert } from "../components/ui/Alert/Alert";
import styles from "./TestOverviewPage.module.scss";

function formatDate(date: string) {
  return new Date(date).toLocaleString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TestOverviewPage() {
  const { testId } = useParams();
  const {
    data: test,
    isLoading,
    error,
  } = useGetTestOverviewQuery(testId ?? "", { skip: !testId });
  if (isLoading)
    return (
      <div className={styles.page}>
        <p role="status">Завантажуємо інформацію про тест…</p>
      </div>
    );
  if (error || !test)
    return (
      <div className={styles.page}>
        <Alert tone="error" title="Не вдалося відкрити тест">
          {error ? queryErrorMessage(error) : "Тест недоступний."}
        </Alert>
        <Link to="/tests">Повернутися до каталогу</Link>
      </div>
    );
  const outOfAttempts = test.remainingAttempts === 0;
  const disabledReason = test.deadlinePassed
    ? "Термін доступу до цього тесту завершився."
    : outOfAttempts
      ? "Ви використали всі дозволені спроби цього тесту. Попередні результати доступні в історії."
      : test.questionCount === 0
        ? "У цьому тесті ще немає питань. Зверніться до викладача."
        : "Нову спробу зараз розпочати не можна.";
  return (
    <div className={styles.page}>
      <Link to="/tests" className={styles.back}>
        <ArrowLeft size={16} /> До всіх тестів
      </Link>
      <header className={styles.heading}>
        <p>ПЕРЕГЛЯД ПЕРЕД ПРОХОДЖЕННЯМ</p>
        <h1>{test.title}</h1>
        <span>
          {test.kind === "survey" ? "Опитування" : "Тест з оцінюванням"} ·
          Версія {test.versionNumber}
        </span>
      </header>
      <div className={styles.grid}>
        <div className={styles.mainColumn}>
          <Card className={styles.card} elevated>
            <h2>Про завдання</h2>
            <p className={styles.description}>
              {test.description?.trim() ||
                "Викладач не додав опису до цього тесту."}
            </p>
            <div className={styles.tags}>
              {test.subject && <span>{test.subject}</span>}
              {test.classGroup && <span>Група: {test.classGroup}</span>}
            </div>
          </Card>
          <Card className={styles.card}>
            <h2>Перед початком</h2>
            <ol className={styles.steps}>
              <li>Перевірте кількість спроб і час проходження.</li>
              <li>
                Після «Почати тест» розпочнеться серверна спроба й, якщо
                встановлено ліміт часу, відлік таймера.
              </li>
              <li>
                Відповіді зберігаються автоматично. Можна переходити між
                питаннями та змінювати вибір до завершення.
              </li>
              <li>Після завершення спроби відповіді вже не можна змінити.</li>
            </ol>
          </Card>
        </div>
        <aside className={styles.sideColumn}>
          <Card className={styles.card} elevated>
            <h2>Параметри тесту</h2>
            <div className={styles.facts}>
              <div>
                <ClipboardList size={19} />
                <span>Запитань</span>
                <strong>{test.questionCount}</strong>
              </div>
              {test.maxPoints !== null && (
                <div>
                  <CheckCircle2 size={19} />
                  <span>Максимальний бал</span>
                  <strong>{test.maxPoints}</strong>
                </div>
              )}
              <div>
                <Clock3 size={19} />
                <span>Час</span>
                <strong>
                  {test.durationMinutes == null
                    ? "Без ліміту часу"
                    : `${test.durationMinutes} хв`}
                </strong>
              </div>
              <div>
                <RotateCcw size={19} />
                <span>Ліміт спроб</span>
                <strong>{test.maxAttempts ?? "Без обмежень"}</strong>
              </div>
              <div>
                <CheckCircle2 size={19} />
                <span>Використано</span>
                <strong>{test.usedAttempts}</strong>
              </div>
              <div>
                <ShieldCheck size={19} />
                <span>Залишилось</span>
                <strong>
                  {test.remainingAttempts == null
                    ? "Без обмежень"
                    : test.remainingAttempts}
                </strong>
              </div>
              <div>
                <CalendarClock size={19} />
                <span>Дедлайн</span>
                <strong>
                  {test.availableUntil
                    ? formatDate(test.availableUntil)
                    : "Не встановлено"}
                </strong>
              </div>
            </div>
            {test.hasActiveAttempt && (
              <Alert tone="info" title="Спроба вже розпочата">
                Продовжуйте поточну спробу. Відлік часу не скидається при
                поверненні.
              </Alert>
            )}
            {!test.canStart && (
              <div className={styles.unavailable} role="status">
                <ShieldCheck size={24} />
                <strong>
                  {outOfAttempts && !test.deadlinePassed
                    ? "Спроби вичерпано"
                    : "Тест недоступний для старту"}
                </strong>
                <p>{disabledReason}</p>
              </div>
            )}
            {test.canStart ? (
              <Link className={styles.start} to={`/tests/${test.id}/run`}>
                {test.hasActiveAttempt ? "Продовжити спробу" : "Почати тест"}
                <ArrowRight size={17} />
              </Link>
            ) : (
              <Link to="/results" className={styles.results}>
                Переглянути мої результати
              </Link>
            )}
            <p className={styles.notice}>
              Початок і завершення спроби визначає сервер. Перегляд цієї
              сторінки не витрачає спробу.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
