import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CheckCircle2 } from "lucide-react";
import { Card } from "../components/ui/Card/Card";
import { Alert } from "../components/ui/Alert/Alert";
import {
  getMySubmissions,
  type SubmissionHistory,
} from "../services/submissionsApi";
import { getTests } from "../services/testsApi";
import styles from "./StudentResultsPage.module.scss";

interface ResultsSnapshot {
  items: SubmissionHistory[];
  titles: Map<string, string>;
}

export function StudentResultsPage() {
  const [snapshot, setSnapshot] = useState<ResultsSnapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([getMySubmissions(), getTests()])
      .then(([items, tests]) => {
        if (!active) return;
        setSnapshot({
          items,
          titles: new Map(tests.map((test) => [test.id, test.title])),
        });
      })
      .catch((err: unknown) => {
        if (active)
          setError(
            err instanceof Error
              ? err.message
              : "Не вдалося завантажити результати",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className={styles.page}>
      <p className={styles.eyebrow}>КАБІНЕТ СТУДЕНТА</p>

      <h1>Мої результати</h1>
      <p className={styles.subtitle}>
        Історія завершених проходжень (останні 50 спроб).
      </p>

      {error && (
        <Alert tone="error" title="Помилка">
          {error}
        </Alert>
      )}

      {!snapshot && !error && <p>Завантаження результатів…</p>}

      {snapshot && (
        <Card className={styles.card}>
          {snapshot.items.length === 0 && (
            <p>
              Ще немає результатів. <Link to="/tests">Перейти до тестів</Link>
            </p>
          )}

          {snapshot.items.map((item) => (
            <div className={styles.row} key={item.id}>
              <span className={styles.icon}>
                <CheckCircle2 size={19} />
              </span>

              <div className={styles.details}>
                <strong>{snapshot.titles.get(item.test_id) ?? "Тест"}</strong>

                <span>
                  {new Date(item.submitted_at).toLocaleString("uk-UA")}
                </span>
              </div>

              <strong className={styles.result}>
                {item.kind === "survey"
                  ? "Опитування"
                  : item.kind === "test" && !item.result_visible
                    ? "Оцінка прихована"
                    : item.score !== null && item.max_score !== null
                      ? `${item.score} / ${item.max_score}`
                      : "Результат недоступний"}
              </strong>

              <Link to={`/results/${item.id}`}>Переглянути →</Link>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
