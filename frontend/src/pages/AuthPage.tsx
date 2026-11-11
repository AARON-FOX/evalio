import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Files,
  GraduationCap,
  Eye,
  EyeOff,
  ShieldCheck,
} from "lucide-react";

import { Alert } from "../components/ui/Alert/Alert";
import { Button } from "../components/ui/Button/Button";
import { TextField } from "../components/ui/TextField/TextField";
import { supabase } from "../lib/supabase";
import {
  getRememberPreference,
  setRememberPreference,
} from "../lib/authStorage";
import styles from "./AuthPage.module.scss";

type AuthMode = "login" | "register" | "forgot" | "reset";

interface AuthPageProps {
  mode: AuthMode;
}

const isStrongPassword = (value: string) =>
  value.length >= 8 && /\p{L}/u.test(value) && /\d/.test(value);

function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  minLength = 8,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  hint?: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  const fieldId = useId();

  return (
    <div className={styles.passwordField}>
      <label htmlFor={fieldId} className={styles.fieldLabel}>
        {label} <span aria-hidden="true">*</span>
      </label>
      <div className={styles.passwordControl}>
        <input
          id={fieldId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          required
        />
        <button
          type="button"
          className={styles.passwordToggle}
          aria-label={visible ? "Приховати пароль" : "Показати пароль"}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <Eye size={19} /> : <EyeOff size={19} />}
        </button>
      </div>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

function Brand() {
  return (
    <Link to="/" className={styles.brand} aria-label="Evalio — головна">
      <span className={styles.brandMark} aria-hidden="true">
        e
      </span>
      <span>evalio</span>
    </Link>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.feature}>
      <span className={styles.featureIcon} aria-hidden="true">
        {icon}
      </span>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </div>
  );
}

function InfoPanel() {
  return (
    <aside className={styles.infoPanel} aria-label="Про платформу Evalio">
      <div className={styles.infoEyebrow}>
        <GraduationCap size={19} aria-hidden="true" />
        <span>НАВЧАЛЬНИЙ ПРОСТІР EVALIO</span>
      </div>
      <h2>Усе для наступного кроку в навчанні.</h2>
      <div className={styles.features}>
        <Feature icon={<Files size={20} />} title="Для викладачів">
          Створюйте тести та переглядайте відповіді студентів.
        </Feature>
        <Feature icon={<BookOpen size={20} />} title="Для студентів">
          Проходьте опубліковані тести та повертайтеся до своїх результатів.
        </Feature>
      </div>
      <div className={styles.panelNote}>
        <ShieldCheck size={19} aria-hidden="true" />
        <span>
          Вхід лише за email і паролем. Ваші навчальні дані — у вашому просторі.
        </span>
      </div>
    </aside>
  );
}

export function AuthPage({ mode }: AuthPageProps) {
  const navigate = useNavigate();
  const isLogin = mode === "login";
  const isRegister = mode === "register";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [remember, setRemember] = useState(getRememberPreference);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setMessage("");

    if ((isRegister || isReset) && !isStrongPassword(password)) {
      setError(
        "Пароль повинен містити щонайменше 8 символів, літеру та цифру.",
      );
      return;
    }
    if ((isRegister || isReset) && password !== confirmPassword) {
      setError("Паролі не збігаються.");
      return;
    }
    if (isRegister && !accepted) {
      setError("Підтвердь згоду з умовами використання.");
      return;
    }

    setBusy(true);
    try {
      if (isLogin) {
        setRememberPreference(remember);
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        // GuestRoute redirects on session change.
      } else if (isRegister) {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/login` },
        });
        if (authError) throw authError;
        setMessage(
          data.session
            ? "Акаунт створено. Відкриваємо особистий кабінет…"
            : "Перевір пошту та підтвердь реєстрацію. Після цього увійди до Evalio.",
        );
      } else if (isForgot) {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: `${window.location.origin}/reset-password` },
        );
        if (authError) throw authError;
        setMessage(
          "Якщо така адреса зареєстрована, на неї надіслано інструкцію з відновлення.",
        );
      } else if (isReset) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session)
          throw new Error(
            "Посилання для відновлення недійсне або його термін дії минув.",
          );
        const { error: authError } = await supabase.auth.updateUser({
          password,
        });
        if (authError) throw authError;
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
      }
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "Не вдалося виконати операцію. Спробуй ще раз.",
      );
    } finally {
      setBusy(false);
    }
  }

  const eyebrow = isLogin ? "РАДІ БАЧИТИ ЗНОВУ" : "ВАШ НАВЧАЛЬНИЙ ПРОСТІР";
  const heading = isLogin
    ? "Увійти в Evalio"
    : isRegister
      ? "Створити акаунт"
      : isForgot
        ? "Відновлення пароля"
        : "Новий пароль";
  const subtitle = isLogin
    ? "Продовжуйте навчання там, де зупинилися."
    : isRegister
      ? "Лише email і пароль, щоб почати."
      : isForgot
        ? "Введи email — надішлемо інструкцію з відновлення."
        : "Введи новий пароль для свого акаунта.";

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Brand />
        <span className={styles.headerHelp}>
          Потрібна допомога? <ArrowUpRight size={14} aria-hidden="true" />
        </span>
      </header>

      <main className={styles.main}>
        <section className={styles.formSection} aria-labelledby="auth-title">
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 id="auth-title">{heading}</h1>
          <p className={styles.subtitle}>{subtitle}</p>

          <form
            className={styles.form}
            onSubmit={(event) => void handleSubmit(event)}
          >
            {!isReset && (
              <TextField
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="andrii.koval@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            )}

            {!isForgot && (
              <PasswordInput
                label={isReset ? "Новий пароль" : "Пароль"}
                value={password}
                onChange={setPassword}
                autoComplete={isLogin ? "current-password" : "new-password"}
                minLength={isLogin ? 6 : 8}
                hint={
                  isRegister || isReset
                    ? "Щонайменше 8 символів, літера та цифра."
                    : undefined
                }
              />
            )}

            {(isRegister || isReset) && (
              <PasswordInput
                label="Підтвердіть пароль"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
              />
            )}

            {isLogin && (
              <div className={styles.formExtra}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                  Запам'ятати мене
                </label>
                <Link to="/forgot-password">Забули пароль?</Link>
              </div>
            )}

            {isRegister && (
              <label className={styles.terms}>
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  required
                />
                <span>
                  Погоджуюся з Умовами використання та Політикою
                  конфіденційності.
                </span>
              </label>
            )}

            {error && <Alert tone="error">{error}</Alert>}
            {message && <Alert tone="success">{message}</Alert>}

            <Button type="submit" fullWidth size="lg" loading={busy}>
              <ArrowRight size={17} aria-hidden="true" />
              {isLogin
                ? "Увійти"
                : isRegister
                  ? "Створити акаунт"
                  : isForgot
                    ? "Надіслати лист"
                    : "Оновити пароль"}
            </Button>
          </form>

          <p className={styles.switch}>
            {isLogin ? (
              <>
                Ще немає акаунта? <Link to="/register">Зареєструватися</Link>
              </>
            ) : isRegister ? (
              <>
                Уже є акаунт? <Link to="/login">Увійти</Link>
              </>
            ) : (
              <Link to="/login">Повернутися до входу</Link>
            )}
          </p>

          {isRegister && (
            <p className={styles.roleNote}>
              Нові користувачі реєструються як студенти. Права викладача
              призначаються окремо.
            </p>
          )}
        </section>

        <InfoPanel />
      </main>

      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} Evalio</span>
        <span>Конфіденційність</span>
      </footer>
    </div>
  );
}
