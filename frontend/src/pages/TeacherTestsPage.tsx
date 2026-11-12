import { useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  FilePlus2,
  FileText,
  PencilLine,
  Trash2,
} from "lucide-react";

import { Card } from "../components/ui/Card/Card";
import { Button } from "../components/ui/Button/Button";
import { Alert } from "../components/ui/Alert/Alert";
import { ConfirmDialog } from "../components/ui/ConfirmDialog/ConfirmDialog";
import {
  useGetTeacherTestsQuery,
  useDeleteTestMutation,
} from "../app/evalioApi";
import { queryErrorMessage } from "../app/queryError";
import styles from "./TeacherTestsPage.module.scss";

export function TeacherTestsPage() {
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [actionError, setActionError] = useState("");
  const [deleteTest, { isLoading: deleting }] = useDeleteTestMutation();

  const { data, isLoading, error: queryError } = useGetTeacherTestsQuery(page);
  const error = queryError ? queryErrorMessage(queryError) : "";
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setActionError("");
    try {
      await deleteTest(deleteTarget.id).unwrap();
      setDeleteTarget(null);
      if (data?.items.length === 1 && page > 1) setPage(page - 1);
    } catch (error) {
      setDeleteTarget(null);
      setActionError(queryErrorMessage(error));
    }
  }

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

      {actionError && (
        <Alert tone="error" title="Не вдалося видалити тест">
          {actionError}
        </Alert>
      )}
      {isLoading && <p role="status">Завантажуємо тести…</p>}
      {error && (
        <Alert tone="error" title="Не вдалося завантажити тести">
          {error}
        </Alert>
      )}

      {data && !error && (
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
              <div className={styles.rowActions}>
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
                <Button
                  variant="danger"
                  size="sm"
                  disabled={deleting}
                  onClick={() => {
                    setActionError("");
                    setDeleteTarget({ id: test.id, title: test.title });
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" /> Видалити
                </Button>
              </div>
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
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Видалити тест?"
        description={
          deleteTarget
            ? `«${deleteTarget.title}» та всі його версії буде приховано для викладача й студентів. Історія проходжень та оцінки залишаться в базі даних. Відновлення через інтерфейс наразі не передбачено.`
            : ""
        }
        confirmLabel="Видалити тест"
        confirmVariant="danger"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
