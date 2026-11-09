import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, FilePlus2, FileText, PencilLine } from "lucide-react";

import { Card } from "../components/ui/Card/Card";
import { Button } from "../components/ui/Button/Button";
import { Alert } from "../components/ui/Alert/Alert";
import {
  getTeacherTests,
  type TeacherTest,
} from "../services/teacherStatisticsApi";
import styles from "./TeacherTestsPage.module.scss";

function describeError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Не вдалося отримати список тестів.";
}

export function TeacherTestsPage() {
  const [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState<{
    page: number;
    items: TeacherTest[];
    total: number;
    pageSize: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void getTeacherTests(page)
      .then((result) => {
        if (active) setSnapshot({ page, ...result });
      })
      .catch((error: unknown) => {
        if (active)
          setSnapshot({
            page,
            items: [],
            total: 0,
            pageSize: 20,
            error: describeError(error),
          });
      });
    return () => {
      active = false;
    };
  }, [page]);

  const data = snapshot?.page === page ? snapshot : null;
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  return (
    <section className={styles.page}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>РОБОЧИЙ ПРОСТІР · ВИКЛАДАЧ</p>
          <h1>Мої тести</h1>
          <p>Створюйте завдання, редагуйте чернетки та керуйте версіями.</p>
        </div>
        <Link className={styles.createLink} to="/teacher/tests/new">
          <FilePlus2 size={18} aria-hidden="true" /> Створити тест
        </Link>
      </div>

      {!data && <p role="status">Завантажуємо тести…</p>}
      {data?.error && (
        <Alert tone="error" title="Не вдалося завантажити тести">
          {data.error}
        </Alert>
      )}

      {data && !data.error && (
        <Card className={styles.list}>
          <div className={styles.listHeader}>
            <h2>Ваші тести</h2>
            <span>{data.total} у списку</span>
          </div>
          {data.items.length === 0 && (
            <div className={styles.empty}>
              <FileText size={28} aria-hidden="true" />
              <h3>Тестів поки немає</h3>
              <p>Почніть із нової чернетки.</p>
              <Link to="/teacher/tests/new">Створити перший тест</Link>
            </div>
          )}
          {data.items.map((test) => (
            <div className={styles.testRow} key={test.id}>
              <div className={styles.testInfo}>
                <strong>{test.title}</strong>
                <span>
                  {test.kind === "survey" ? "Опитування" : "Тест"} ·{" "}
                  {new Date(test.created_at).toLocaleDateString("uk-UA")}
                </span>
              </div>
              <span
                className={
                  test.status === "draft" ? styles.draft : styles.published
                }
              >
                {test.status === "draft" ? "Чернетка" : "Опубліковано"}
              </span>
              <Link
                className={styles.editLink}
                to={`/teacher/tests/${test.id}/edit`}
              >
                {test.status === "draft" ? (
                  <PencilLine size={17} aria-hidden="true" />
                ) : (
                  <ArrowRight size={17} aria-hidden="true" />
                )}
                {test.status === "draft" ? "Редагувати" : "Переглянути"}
              </Link>
            </div>
          ))}
          {data.total > data.pageSize && (
            <div className={styles.pagination}>
              <Button
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                Назад
              </Button>
              <span>
                Сторінка {page} з {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((prev) => prev + 1)}
              >
                Далі
              </Button>
            </div>
          )}
        </Card>
      )}
    </section>
  );
}
