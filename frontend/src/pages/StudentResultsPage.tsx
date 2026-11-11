import { Link } from "react-router";
import { CheckCircle2 } from "lucide-react";
import { Card } from "../components/ui/Card/Card";
import { Alert } from "../components/ui/Alert/Alert";
import { useGetMySubmissionsQuery, useGetCatalogQuery } from "../app/evalioApi";
import { queryErrorMessage } from "../app/queryError";
import styles from "./StudentResultsPage.module.scss";

export function StudentResultsPage() {
  const {
    data: items,
    isLoading: loadingHistory,
    error: historyError,
  } = useGetMySubmissionsQuery();
  const {
    data: tests,
    isLoading: loadingCatalog,
    error: catalogError,
  } = useGetCatalogQuery();
  const error = historyError
    ? queryErrorMessage(historyError)
    : catalogError
      ? queryErrorMessage(catalogError)
      : "";
  const snapshot =
    items && tests
      ? {
          items,
          titles: new Map(tests.map((test) => [test.id, test.title])),
        }
      : null;
  const loading = loadingHistory || loadingCatalog;

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

      {loading && <p>Завантаження результатів…</p>}

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
