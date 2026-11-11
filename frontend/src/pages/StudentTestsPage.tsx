import { Link } from "react-router";
import { ClipboardList } from "lucide-react";
import { Card } from "../components/ui/Card/Card";
import { Alert } from "../components/ui/Alert/Alert";
import { useGetCatalogQuery } from "../app/evalioApi";
import { queryErrorMessage } from "../app/queryError";
import styles from "./StudentTestsPage.module.scss";

export function StudentTestsPage() {
  const {
    data: tests = [],
    isLoading: loading,
    error: queryError,
  } = useGetCatalogQuery();
  const error = queryError ? queryErrorMessage(queryError) : "";

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <p>КАБІНЕТ СТУДЕНТА</p>
        <h1>Доступні тести</h1>
        <span>Оберіть тест, щоб почати або продовжити спробу.</span>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {loading ? (
        <p>Завантаження…</p>
      ) : tests.length === 0 ? (
        <Card>
          <p>Поки немає опублікованих тестів.</p>
        </Card>
      ) : (
        <div className={styles.list}>
          {tests.map((test) => (
            <Card key={test.id}>
              <ClipboardList size={20} aria-hidden="true" />
              <div>
                <h2>{test.title}</h2>
                {test.description && (
                  <p className={styles.testDescription}>{test.description}</p>
                )}
                <small>
                  {[test.subject, test.class_group].filter(Boolean).join(" · ")}
                </small>
              </div>
              <Link to={`/tests/${test.id}`} className={styles.open}>
                {test.kind === "survey" ? "Відкрити опитування" : "Почати тест"}
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
