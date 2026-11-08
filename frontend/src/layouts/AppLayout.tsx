import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import {
  LayoutDashboard,
  Files,
  BarChart3,
  LogOut,
  GraduationCap,
} from "lucide-react";

import { useAuth } from "../context/useAuth";
import { supabase } from "../lib/supabase";
import styles from "./AppLayout.module.scss";

type NavigationItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
};

const creatorNav: NavigationItem[] = [
  { to: "/dashboard", label: "Огляд", icon: LayoutDashboard },
  { to: "/teacher/tests", label: "Мої тести", icon: Files },
  { to: "/teacher/statistics", label: "Результати", icon: BarChart3 },
];

const studentNav: NavigationItem[] = [
  { to: "/dashboard", label: "Огляд", icon: LayoutDashboard },
  { to: "/tests", label: "Мої тести", icon: Files },
  { to: "/results", label: "Результати", icon: BarChart3 },
];

export function AppLayout() {
  const { profile } = useAuth();
  const location = useLocation();
  const [signOutError, setSignOutError] = useState("");
  if (!profile) return null;

  const isCreator = profile.role === "creator";
  const roleLabel = isCreator ? "Викладач" : "Студент";
  const nav = isCreator ? creatorNav : studentNav;
  const initials = (profile.email?.split("@")[0] || "E")
    .slice(0, 2)
    .toUpperCase();
  const activeItem = nav.find(
    (item) =>
      location.pathname === item.to ||
      (item.to === "/tests" && location.pathname.startsWith("/tests/")),
  );

  async function handleSignOut() {
    setSignOutError("");
    const { error } = await supabase.auth.signOut();
    if (error) setSignOutError(error.message);
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Навігація Evalio">
        <Link
          to="/dashboard"
          className={styles.brand}
          aria-label="Evalio — огляд"
        >
          <span className={styles.brandIcon} aria-hidden="true">
            e
          </span>
          <span>evalio</span>
        </Link>

        <div className={styles.sidebarLabel}>РОБОЧИЙ ПРОСТІР</div>
        <div className={styles.rolePill}>• {roleLabel}</div>

        <nav className={styles.sidebarNav} aria-label="Головне меню">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/dashboard"}
              className={({ isActive }) =>
                [styles.navLink, isActive ? styles.active : ""]
                  .filter(Boolean)
                  .join(" ")
              }
            >
              <Icon size={19} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarBottom}>
          <div className={styles.supportCard}>
            <GraduationCap size={20} aria-hidden="true" />
            <strong>Потрібна допомога?</strong>
            <span>Поради та відповіді щодо роботи з Evalio.</span>
          </div>
          <span className={styles.copyright}>© 2026 Evalio</span>
        </div>
      </aside>

      <div className={styles.pageArea}>
        <header className={styles.topbar}>
          <div className={styles.mobileBrand}>
            <Link
              to="/dashboard"
              className={styles.brand}
              aria-label="Evalio — огляд"
            >
              <span className={styles.brandIcon} aria-hidden="true">
                e
              </span>
              <span>evalio</span>
            </Link>
          </div>
          <div className={styles.breadcrumb}>
            Навчальний простір / {activeItem?.label ?? "Огляд"}
          </div>
          <div className={styles.account}>
            <div className={styles.avatar} aria-hidden="true">
              {initials}
            </div>
            <div className={styles.accountInfo}>
              <strong>{profile.email ?? "Користувач"}</strong>
              <span>{roleLabel}</span>
            </div>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className={styles.signOut}
              aria-label="Вийти з акаунта"
              title="Вийти з акаунта"
            >
              <LogOut size={19} />
            </button>
          </div>
        </header>

        {signOutError && (
          <p role="alert" className={styles.error}>
            {signOutError}
          </p>
        )}
        <main id="main-content" className={styles.content}>
          <Outlet />
        </main>
      </div>

      <nav className={styles.mobileNav} aria-label="Мобільна навігація">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [styles.mobileNavItem, isActive ? styles.mobileActive : ""]
                .filter(Boolean)
                .join(" ")
            }
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
