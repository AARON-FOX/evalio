import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from '../context/useAuth';

export function ProtectedRoute() {
  const { initialized, session, profile, profileError } = useAuth();

  const location = useLocation();

  if (!initialized) {
    return <p>Перевірка авторизації...</p>;
  }

  if (!session) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location.pathname + location.search,
        }}
      />
    );
  }

  if (profileError) {
    return (
      <div role="alert">
        <p>Помилка перевірки користувача.</p>
        <p>{profileError}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Повторити
        </button>
      </div>
    );
  }

  if (!profile) {
    return <p>Завантаження профілю...</p>;
  }

  return <Outlet />;
}
