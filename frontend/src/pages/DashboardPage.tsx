import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  Files,
  Search,
  Users,
} from "lucide-react";

import { useAuth } from "../context/useAuth";
import { Button } from "../components/ui/Button/Button";
import { Card } from "../components/ui/Card/Card";
import { Alert } from "../components/ui/Alert/Alert";
import { type TeacherDashboardTest } from "../services/dashboardApi";
import {
  useGetTeacherDashboardQuery,
  useGetStudentDashboardQuery,
} from "../app/evalioApi";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import {
  setDashboardPage,
  setDashboardSearch,
  setDashboardStatus,
} from "../app/dashboardFiltersSlice";
import { queryErrorMessage } from "../app/queryError";
import styles from "./DashboardPage.module.scss";

type IconComponent = typeof Files;

function Metric({
  label,
  value,
  caption,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  caption: string;
  icon: IconComponent;
}) {
  return (
    <Card className={styles.metricCard}>
      <div className={styles.metricTop}>
        <span>{label}</span>
        <Icon size={19} aria-hidden="true" />
      </div>
      <strong className={styles.metricValue}>{value}</strong>
      <span className={styles.metricCaption}>{caption}</span>
    </Card>
  );
}

function SectionHeading({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className={styles.sectionHeading}>
      <h2>{children}</h2>
      {trailing && <div className={styles.sectionTrailing}>{trailing}</div>}
    </div>
  );
}

function StatusLabel({ status }: { status: "draft" | "published" }) {
  return (
    <span className={status === "published" ? styles.published : styles.draft}>
      • {status === "published" ? "Опубліковано" : "Чернетка"}
    </span>
  );
}

function dateText(date: string) {
  return new Date(date).toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function percent(value: number | null) {
  return value === null ? "—" : `${value.toLocaleString("uk-UA")}%`;
}

export function DashboardPage() {
  const { profile } = useAuth();
  if (!profile) return null;

  if (profile.role === "creator") {
    return <TeacherDashboard key={profile.id} />;
  }
  return <StudentDashboard key={profile.id} />;
}

function TeacherDashboard() {
  const dispatch = useAppDispatch();
  const { page, status, search } = useAppSelector(
    (state) => state.dashboardFilters,
  );
  const [searchInput, setSearchInput] = useState(search);
  const { data, isLoading, error } = useGetTeacherDashboardQuery({
    page,
    status,
    search,
  });
  const current = isLoading
    ? null
    : {
        data,
        error: error ? queryErrorMessage(error) : undefined,
      };
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch(setDashboardSearch(searchInput.trim()));
  }

  function handleStatus(next: "all" | "draft" | "published") {
    dispatch(setDashboardStatus(next));
  }

  return (
    <section className={styles.dashboard}>
      <div className={styles.headingRow}>
        <div>
          <p className={styles.eyebrow}>КАБІНЕТ ВИКЛАДАЧА</p>
          <h1>Вітаємо!</h1>
          <p className={styles.subtitle}>
            Ваші тести та результати студентів — в одному місці.
          </p>
        </div>
        <Link to="/teacher/tests/new" className={styles.primaryLink}>
          <FilePlus2 size={18} aria-hidden="true" /> Створити тест
        </Link>
      </div>

      {!current && (
        <p role="status" className={styles.loading}>
          Завантажуємо дані кабінету…
        </p>
      )}
      {current?.error && (
        <Alert tone="error" title="Помилка завантаження">
          {current.error}
        </Alert>
      )}
      {data && (
        <>
          <div className={`${styles.metrics} ${styles.teacherMetrics}`}>
            <Metric
              label="Усього тестів"
              value={data.stats.totalTests}
              caption="Створені вами"
              icon={Files}
            />
            <Metric
              label="Активні тести"
              value={data.stats.publishedTests}
              caption="Опубліковані"
              icon={ClipboardList}
            />
            <Metric
              label="Проходження"
              value={data.stats.totalAttempts}
              caption="Усі завершені спроби"
              icon={Users}
            />
            <Metric
              label="Середній результат"
              value={percent(data.stats.averagePercent)}
              caption="За оціненими спробами"
              icon={BarChart3}
            />
          </div>

          <div className={styles.sectionGap}>
            <SectionHeading
              trailing={<span>{data.stats.totalTests} тестів загалом</span>}
            >
              Мої тести
            </SectionHeading>

            <div
              className={styles.filters}
              role="group"
              aria-label="Фільтр за статусом"
            >
              {(
                [
                  ["all", "Усі"],
                  ["published", "Опубліковані"],
                  ["draft", "Чернетки"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={status === value ? "primary" : "outline"}
                  onClick={() => handleStatus(value)}
                  aria-pressed={status === value}
                >
                  {label}
                </Button>
              ))}
            </div>

            <form className={styles.searchForm} onSubmit={handleSearch}>
              <Search size={19} aria-hidden="true" />
              <label className={styles.srOnly} htmlFor="teacher-tests-search">
                Знайти тест за назвою
              </label>
              <input
                id="teacher-tests-search"
                type="search"
                maxLength={100}
                placeholder="Знайти тест за назвою"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
              <Button type="submit" variant="outline" size="sm">
                Знайти
              </Button>
            </form>

            <Card className={styles.tableCard}>
              <div className={styles.tableScroll}>
                <table className={styles.testsTable}>
                  <thead>
                    <tr>
                      <th>НАЗВА ТЕСТУ</th>
                      <th>СТАТУС</th>
                      <th>УЧАСНИКИ</th>
                      <th>СЕРЕДНІЙ РЕЗУЛЬТАТ</th>
                      <th>ДІЇ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((test) => (
                      <tr key={test.id}>
                        <td>
                          <strong>{test.title}</strong>
                          <span className={styles.rowSubline}>
                            {test.kind === "test" ? "Тест" : "Опитування"} ·{" "}
                            {dateText(test.createdAt)}
                          </span>
                        </td>
                        <td>
                          <StatusLabel status={test.status} />
                        </td>
                        <td>
                          {test.status === "draft"
                            ? "—"
                            : test.participantCount}
                        </td>
                        <td>
                          {test.status === "draft"
                            ? "—"
                            : percent(test.averagePercent)}
                        </td>
                        <td>
                          <Link
                            to={`/teacher/tests/${test.id}/edit`}
                            className={styles.outlineLink}
                          >
                            Відкрити
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.items.length === 0 && (
                <p className={styles.empty}>
                  За цими параметрами тестів немає.
                </p>
              )}

              <div className={styles.mobileTestList}>
                {data.items.map((test) => (
                  <TeacherMobileTest key={test.id} test={test} />
                ))}
              </div>

              <div className={styles.tableFooter}>
                <span>
                  Показано {data.items.length} із {data.total}
                </span>
                <div className={styles.pager}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => dispatch(setDashboardPage(page - 1))}
                  >
                    Назад
                  </Button>
                  <span>
                    {page} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => dispatch(setDashboardPage(page + 1))}
                  >
                    Далі
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          <Card className={styles.recentCard} elevated>
            <SectionHeading>Останні проходження</SectionHeading>
            {data.recentSubmissions.length === 0 && (
              <p className={styles.empty}>
                Студенти ще не проходили ваші тести.
              </p>
            )}
            {data.recentSubmissions.map((attempt) => (
              <div className={styles.recentRow} key={attempt.id}>
                <span className={styles.recentAvatar}>
                  {attempt.respondentId.slice(0, 2).toUpperCase()}
                </span>
                <div className={styles.recentText}>
                  <strong>Учасник {attempt.respondentId.slice(0, 8)}</strong>
                  <span>
                    {attempt.testTitle} · {dateText(attempt.submittedAt)}
                  </span>
                </div>
                <strong className={styles.recentScore}>
                  {attempt.score === null || attempt.maxScore === null
                    ? "Опитування"
                    : `${attempt.score} / ${attempt.maxScore}`}
                </strong>
              </div>
            ))}
            <Link to="/teacher/statistics" className={styles.inlineLink}>
              Переглянути всю статистику <ArrowRight size={16} />
            </Link>
          </Card>
        </>
      )}
    </section>
  );
}

function TeacherMobileTest({ test }: { test: TeacherDashboardTest }) {
  return (
    <div className={styles.teacherMobileItem}>
      <StatusLabel status={test.status} />
      <h3>{test.title}</h3>
      <p className={styles.muted}>
        {test.kind === "test" ? "Тест" : "Опитування"} ·{" "}
        {dateText(test.createdAt)}
      </p>
      <div className={styles.mobileStats}>
        <div>
          <span>Учасники</span>
          <strong>
            {test.status === "draft" ? "—" : test.participantCount}
          </strong>
        </div>
        <div>
          <span>Середній результат</span>
          <strong>
            {test.status === "draft" ? "—" : percent(test.averagePercent)}
          </strong>
        </div>
      </div>
      <Link to="/teacher/tests" className={styles.outlineLink}>
        {test.status === "draft" ? "Продовжити створення" : "Відкрити тест"}
      </Link>
    </div>
  );
}

function StudentDashboard() {
  const { data, isLoading, error } = useGetStudentDashboardQuery();
  const snapshot = isLoading
    ? null
    : {
        error: error ? queryErrorMessage(error) : undefined,
      };
  return (
    <section className={styles.dashboard}>
      <div className={styles.headingRow}>
        <div>
          <p className={styles.eyebrow}>КАБІНЕТ СТУДЕНТА</p>
          <h1>Вітаємо!</h1>
          <p className={styles.subtitle}>
            Обирайте доступні тести та переглядайте свій прогрес.
          </p>
        </div>
      </div>

      {!snapshot && (
        <p role="status" className={styles.loading}>
          Завантажуємо навчальний простір…
        </p>
      )}
      {snapshot?.error && (
        <Alert tone="error" title="Помилка завантаження">
          {snapshot.error}
        </Alert>
      )}
      {data && (
        <>
          <div className={`${styles.metrics} ${styles.studentMetrics}`}>
            <Metric
              label="Ще не проходили"
              value={data.availableCount}
              caption="Опубліковані тести й опитування"
              icon={ClipboardList}
            />
            <Metric
              label="Завершено"
              value={data.completedTests}
              caption={`${data.totalAttempts} спроб загалом`}
              icon={CheckCircle2}
            />
            <Metric
              label="Середній результат"
              value={percent(data.averagePercent)}
              caption="За оціненими спробами"
              icon={BarChart3}
            />
          </div>

          <div className={styles.sectionGap}>
            <SectionHeading
              trailing={<span>{data.availableCount} доступно вперше</span>}
            >
              До проходження
            </SectionHeading>
            {data.availableTests.length === 0 ? (
              <Card className={styles.emptyCard}>
                Наразі немає нових тестів. Повторно пройти вже завершені можна в
                каталозі.
              </Card>
            ) : (
              <div className={styles.assignedGrid}>
                {data.availableTests.map((test, index) => (
                  <Card key={test.id} className={styles.assignedCard}>
                    <div className={styles.assignedHead}>
                      <span className={styles.assignedIcon}>
                        <ClipboardList size={19} />
                      </span>
                      <span className={styles.assignedPill}>• Доступно</span>
                    </div>
                    <p className={styles.muted}>
                      {test.kind === "test" ? "Тест" : "Опитування"}
                    </p>
                    <h3>{test.title}</h3>
                    {test.description && (
                      <p className={styles.description}>{test.description}</p>
                    )}
                    <div className={styles.assignedMeta}>
                      <span>
                        <Files size={16} aria-hidden="true" />{" "}
                        {test.questionCount} питань
                      </span>
                      <span>
                        {test.kind === "test"
                          ? "Автоматичне оцінювання"
                          : "Без оцінювання"}
                      </span>
                    </div>
                    <Link
                      to={`/tests/${test.id}`}
                      className={
                        index === 0 ? styles.primaryLink : styles.outlineLink
                      }
                    >
                      <ArrowRight size={17} aria-hidden="true" /> Почати
                    </Link>
                  </Card>
                ))}
              </div>
            )}
            {data.availableCount > data.availableTests.length && (
              <p className={styles.muted}>
                Показано {data.availableTests.length} останніх.{" "}
                <Link to="/tests">Усі тести</Link>
              </p>
            )}
          </div>

          <Card className={styles.recentCard} elevated>
            <SectionHeading>Останні результати</SectionHeading>
            {data.recentSubmissions.length === 0 && (
              <p className={styles.empty}>Ще немає завершених проходжень.</p>
            )}
            {data.recentSubmissions.map((attempt) => (
              <div className={styles.recentRow} key={attempt.id}>
                <span
                  className={`${styles.recentAvatar} ${styles.resultAvatar}`}
                >
                  <CheckCircle2 size={18} />
                </span>
                <div className={styles.recentText}>
                  <strong>{attempt.testTitle}</strong>
                  <span>{dateText(attempt.submittedAt)}</span>
                </div>
                <strong className={styles.recentScore}>
                  {attempt.kind === "survey"
                    ? "Опитування"
                    : !attempt.resultVisible
                      ? "Оцінка прихована"
                      : attempt.score !== null && attempt.maxScore !== null
                        ? `${attempt.score} / ${attempt.maxScore}`
                        : "Результат недоступний"}
                </strong>
              </div>
            ))}
            <Link to="/results" className={styles.inlineLink}>
              Переглянути історію <ArrowRight size={16} />
            </Link>
          </Card>

          <div className={styles.tip}>
            <CheckCircle2 size={19} aria-hidden="true" />
            <span>
              Після проходження тесту можна переглянути свої результати в
              розділі «Результати».
            </span>
          </div>
        </>
      )}
    </section>
  );
}
