import { Navigate, Outlet } from "react-router";
import { useAuth } from '../context/useAuth';

type Role = "creator" | "respondent";

interface RoleRouteProps {
  allowedRole: Role;
}

export function RoleRoute({ allowedRole }: RoleRouteProps) {
  const { profile } = useAuth();

  if (!profile) {
    return <p>Завантаження профілю...</p>;
  }

  if (profile.role !== allowedRole) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
