import { useState } from "react";

import { Link, NavLink, Outlet } from "react-router";

import { supabase } from "../lib/supabase";
import { useAuth } from '../context/useAuth';

export function AppLayout() {
  const { profile } = useAuth();

  const [logoutError, setLogoutError] = useState("");

  async function handleSignOut() {
    setLogoutError("");

    const { error } = await supabase.auth.signOut();

    if (error) {
      setLogoutError(error.message);
    }
  }

  if (!profile) return null;

  const isCreator = profile.role === "creator";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/dashboard" className="app-logo">
            Evalio
          </Link>

          <nav className="app-navigation" aria-label="Головна навігація">
            <NavLink to="/dashboard">Кабінет</NavLink>

            {isCreator ? (
              <>
                <NavLink to="/teacher/tests">Мої тести</NavLink>

                <NavLink to="/teacher/statistics">Статистика</NavLink>
              </>
            ) : (
              <NavLink to="/tests">Проходження тестів</NavLink>
            )}
          </nav>

          <div className="app-user">
            <span>{isCreator ? "Викладач" : "Студент"}</span>

            <button type="button" onClick={() => void handleSignOut()}>
              Вийти
            </button>
          </div>
        </div>
      </header>

      {logoutError && (
        <p role="alert" className="app-error">
          {logoutError}
        </p>
      )}

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
