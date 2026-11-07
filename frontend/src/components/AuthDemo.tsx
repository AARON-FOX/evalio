import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "../lib/supabase";
import { getCurrentUser, type CurrentUserResponse } from "../services/api";

export function AuthDemo() {
  const [mode, setMode] = useState<"signup" | "signin">("signup");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [session, setSession] = useState<Session | null>(null);

  const [profile, setProfile] = useState<CurrentUserResponse | null>(null);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Listen to authentication state changes
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const accessToken = session?.access_token;

  // Load user profile from Express
  useEffect(() => {
    if (!accessToken) return;

    const controller = new AbortController();

    getCurrentUser(accessToken, controller.signal)
      .then((data) => {
        setProfile(data);
        setError("");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;

        setError(err instanceof Error ? err.message : "Could not load profile");
      });

    return () => controller.abort();
  }, [accessToken]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });

        if (authError) throw authError;

        setMessage(
          data.session
            ? "Registration successful."
            : "Check your email to confirm registration.",
        );
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (authError) throw authError;

        setMessage("Signed in successfully.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    const { error: authError } = await supabase.auth.signOut();

    if (authError) {
      setError(authError.message);
    } else {
      setProfile(null);
      setMessage("");
      setError("");
    }
  }

  if (!ready) {
    return <p>Checking authentication...</p>;
  }

  const currentProfile = profile?.id === session?.user.id ? profile : null;

  return (
    <section className="auth-demo">
      <h2>Authentication</h2>

      {session ? (
        <>
          <p>Signed in as: {session.user.email}</p>

          {currentProfile ? (
            <p>Role: {currentProfile.role}</p>
          ) : (
            <p>Loading profile...</p>
          )}

          <button type="button" onClick={handleSignOut}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />

            <button type="submit" disabled={busy}>
              {busy
                ? "Please wait..."
                : mode === "signup"
                  ? "Sign up"
                  : "Sign in"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setError("");
              setMessage("");
            }}
          >
            {mode === "signup"
              ? "Already have an account? Sign in"
              : "Create an account"}
          </button>
        </>
      )}

      {message && <p>{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
