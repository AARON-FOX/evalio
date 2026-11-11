import { useState } from "react";
import type { FormEvent } from "react";
import {
  ClipboardClock,
  Search,
  ShieldCheck,
  UserRoundCog,
  Users,
} from "lucide-react";

import { useAuth } from "../context/useAuth";
import { Alert } from "../components/ui/Alert/Alert";
import { Button } from "../components/ui/Button/Button";
import { Card } from "../components/ui/Card/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog/ConfirmDialog";
import {
  useChangeUserRoleMutation,
  useGetAdminAuditQuery,
  useGetAdminUsersQuery,
} from "../app/evalioApi";
import { queryErrorMessage } from "../app/queryError";
import type {
  AdminRoleFilter,
  AdminUser,
  EditableRole,
} from "../services/adminApiTypes";
import styles from "./AdminUsersPage.module.scss";

const ROLE_NAMES = {
  respondent: "Студент",
  creator: "Викладач",
  admin: "Супер-адміністратор",
} as const;

function prettyDate(value: string | null): string {
  return value
    ? new Date(value).toLocaleDateString("uk-UA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
}

function RolePill({ role }: { role: AdminUser["role"] }) {
  return (
    <span className={`${styles.rolePill} ${styles[role]}`}>
      {ROLE_NAMES[role]}
    </span>
  );
}

type PendingChange = {
  id: string;
  email: string;
  nextRole: EditableRole;
};

export function AdminUsersPage() {
  const { profile } = useAuth();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<AdminRoleFilter>("all");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  const { data, isLoading, isFetching, error } = useGetAdminUsersQuery({
    page,
    role,
    search,
  });
  const { data: audit, error: auditError } = useGetAdminAuditQuery();
  const [changeUserRole, { isLoading: isChanging }] =
    useChangeUserRoleMutation();
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  function searchUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  function requestChange(user: AdminUser, nextRole: EditableRole) {
    if (
      user.id === profile?.id ||
      user.role === "admin" ||
      user.role === nextRole
    )
      return;
    setNotice("");
    setActionError("");
    setPending({ id: user.id, email: user.email ?? user.id, nextRole });
  }

  async function confirmChange() {
    if (!pending || isChanging) return;
    try {
      const result = await changeUserRole({
        userId: pending.id,
        role: pending.nextRole,
      }).unwrap();
      setNotice(
        result.changed
          ? `Роль користувача ${pending.email} змінено на «${ROLE_NAMES[pending.nextRole]}».`
          : `Користувач уже має роль «${ROLE_NAMES[pending.nextRole]}».`,
      );
      setPending(null);
    } catch (err) {
      setActionError(queryErrorMessage(err));
      setPending(null);
    }
  }

  function roleActions(user: AdminUser) {
    if (user.role === "admin")
      return <span className={styles.readonly}>Захищена роль</span>;
    if (user.id === profile?.id)
      return <span className={styles.readonly}>Власний акаунт</span>;

    return (
      <div className={styles.actions}>
        <Button
          type="button"
          size="sm"
          variant={user.role === "respondent" ? "primary" : "outline"}
          onClick={() => requestChange(user, "creator")}
          disabled={isChanging || user.role === "creator"}
        >
          Зробити викладачем
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => requestChange(user, "respondent")}
          disabled={isChanging || user.role === "respondent"}
        >
          Зробити студентом
        </Button>
      </div>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            <ShieldCheck size={16} /> АДМІНІСТРУВАННЯ EVALIO
          </p>
          <h1>Користувачі та ролі</h1>
          <p>
            Керування доступом студентів і викладачів. Дії записуються в журнал.
          </p>
        </div>
      </header>

      {data && (
        <div
          className={styles.metrics}
          aria-label="Загальна кількість користувачів за ролями"
        >
          <Card>
            <span>Усього користувачів</span>
            <strong>{data.summary.total}</strong>
            <Users size={20} />
          </Card>
          <Card>
            <span>Студентів</span>
            <strong>{data.summary.respondents}</strong>
            <Users size={20} />
          </Card>
          <Card>
            <span>Викладачів</span>
            <strong>{data.summary.creators}</strong>
            <UserRoundCog size={20} />
          </Card>
          <Card>
            <span>Адміністраторів</span>
            <strong>{data.summary.admins}</strong>
            <ShieldCheck size={20} />
          </Card>
        </div>
      )}

      {notice && (
        <Alert tone="success" title="Зміни збережено">
          {notice}
        </Alert>
      )}
      {actionError && (
        <Alert tone="error" title="Не вдалося змінити роль">
          {actionError}
        </Alert>
      )}
      {error && (
        <Alert tone="error" title="Помилка отримання користувачів">
          {queryErrorMessage(error)}
        </Alert>
      )}

      <Card className={styles.listCard}>
        <div className={styles.sectionHead}>
          <h2>Список користувачів</h2>
          <span>{data?.total ?? 0} знайдено</span>
        </div>
        <div className={styles.filters}>
          <form
            className={styles.searchForm}
            onSubmit={searchUsers}
            role="search"
          >
            <label
              htmlFor="admin-users-search"
              className={styles.visuallyHidden}
            >
              Пошук за email
            </label>
            <Search size={18} aria-hidden="true" />
            <input
              id="admin-users-search"
              type="search"
              placeholder="Пошук за email"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              maxLength={100}
            />
            <Button type="submit" size="sm">
              Пошук
            </Button>
          </form>
          <label className={styles.roleFilter}>
            Роль
            <select
              value={role}
              onChange={(event) => {
                setRole(event.target.value as AdminRoleFilter);
                setPage(1);
              }}
            >
              <option value="all">Усі ролі</option>
              <option value="respondent">Студенти</option>
              <option value="creator">Викладачі</option>
              <option value="admin">Адміністратори</option>
            </select>
          </label>
        </div>
        {isLoading && <p role="status">Завантажуємо користувачів…</p>}
        {isFetching && !isLoading && (
          <p className={styles.updating} role="status">
            Оновлюємо список…
          </p>
        )}
        {data?.items.length === 0 && (
          <p>Користувачів за цими умовами не знайдено.</p>
        )}
        {data && data.items.length > 0 && (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Роль</th>
                    <th>Реєстрація</th>
                    <th>Останній вхід</th>
                    <th>Дії</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((user) => (
                    <tr key={user.id}>
                      <td className={styles.emailCell}>
                        {user.email ?? user.id}
                      </td>
                      <td>
                        <RolePill role={user.role} />
                      </td>
                      <td>{prettyDate(user.created_at)}</td>
                      <td>{prettyDate(user.last_sign_in_at)}</td>
                      <td>{roleActions(user)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.mobileCards}>
              {data.items.map((user) => (
                <div className={styles.mobileCard} key={user.id}>
                  <strong className={styles.emailCell}>
                    {user.email ?? user.id}
                  </strong>
                  <RolePill role={user.role} />
                  <p>Реєстрація: {prettyDate(user.created_at)}</p>
                  <p>Останній вхід: {prettyDate(user.last_sign_in_at)}</p>
                  {roleActions(user)}
                </div>
              ))}
            </div>
          </>
        )}
        <div className={styles.pager}>
          <span>
            Сторінка {page} з {pages}
          </span>
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((old) => old - 1)}
            >
              Назад
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pages || isFetching}
              onClick={() => setPage((old) => old + 1)}
            >
              Далі
            </Button>
          </div>
        </div>
      </Card>

      <Card className={styles.auditCard}>
        <div className={styles.sectionHead}>
          <h2>
            <ClipboardClock size={21} /> Останні зміни ролей
          </h2>
          <span>До 20 останніх операцій</span>
        </div>
        {auditError && (
          <Alert tone="error">{queryErrorMessage(auditError)}</Alert>
        )}
        {audit?.length === 0 && <p>Змін ролей поки не було.</p>}
        {audit?.map((entry) => (
          <div key={entry.id} className={styles.auditRow}>
            <div>
              <strong>{entry.target_email ?? entry.target_id}</strong>
              <p>
                {ROLE_NAMES[entry.old_role]} → {ROLE_NAMES[entry.new_role]}
              </p>
              <small>
                Адміністратор: {entry.actor_email ?? entry.actor_id}
              </small>
            </div>
            <time dateTime={entry.changed_at}>
              {new Date(entry.changed_at).toLocaleString("uk-UA")}
            </time>
          </div>
        ))}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title="Підтвердити зміну ролі"
        description={
          pending
            ? `Змінити роль ${pending.email} на «${ROLE_NAMES[pending.nextRole]}»? Ця дія змінить доступ користувача до функцій Evalio.`
            : ""
        }
        confirmLabel="Змінити роль"
        busy={isChanging}
        onConfirm={() => void confirmChange()}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
