import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from '../context/useAuth';

export function GuestRoute() {
  const { initialized, session, profile, profileError } = useAuth();

  const location = useLocation();

  if (!initialized) {
    return <p>Перевірка авторизації...</p>;
  }

  if (session) {
    if (profileError) {
      return (
        <div role="alert">
          <p>Не вдалося перевірити профіль.</p>
          <p>{profileError}</p>
        </div>
      );
    }

    if (!profile) {
      return <p>Завантаження профілю...</p>;
    }

    const requestedPath: unknown = location.state?.from;

    const destination =
      typeof requestedPath === "string" &&
      requestedPath.startsWith("/") &&
      !requestedPath.startsWith("//") &&
      !requestedPath.startsWith("/\\")
        ? requestedPath
        : "/dashboard";

    return <Navigate to={destination} replace />;
  }

  return <Outlet />;
}
