import { useState } from "react";
import type { FormEvent } from "react";

import { Link, useLocation } from "react-router";

import { supabase } from "../lib/supabase";

interface AuthPageProps {
  mode: "login" | "register";
}

export function AuthPage({ mode }: AuthPageProps) {
  const location = useLocation();

  const isLogin = mode === "login";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (isLogin) {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (authError) throw authError;

        // GuestRoute will redirect after AuthContext
        // receives and verifies the new session.
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
          },
        });

        if (authError) throw authError;

        if (!data.session) {
          setMessage(
            "Перевір email та підтвердь реєстрацію. " +
              "Після цього увійди до Evalio.",
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка авторизації");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Evalio</h1>

        <h2>{isLogin ? "Вхід" : "Реєстрація"}</h2>

        <p>
          {isLogin
            ? "Увійди до свого облікового запису"
            : "Створи обліковий запис"}
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="auth-email">Email</label>

          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label htmlFor="auth-password">Пароль</label>

          <input
            id="auth-password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />

          <button type="submit" disabled={busy}>
            {busy ? "Зачекай..." : isLogin ? "Увійти" : "Зареєструватися"}
          </button>
        </form>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        {message && (
          <p className="auth-success" role="status">
            {message}
          </p>
        )}

        <p className="auth-switch">
          {isLogin ? (
            <>
              Немає акаунта?{" "}
              <Link to="/register" state={location.state}>
                Зареєструватися
              </Link>
            </>
          ) : (
            <>
              Уже маєш акаунт?{" "}
              <Link to="/login" state={location.state}>
                Увійти
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
