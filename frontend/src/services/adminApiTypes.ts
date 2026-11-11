export type EvalioRole = "respondent" | "creator" | "admin";
export type EditableRole = "respondent" | "creator";
export type AdminRoleFilter = EvalioRole | "all";

export interface AdminUser {
  id: string;
  email: string | null;
  role: EvalioRole;
  created_at: string;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
}

export interface AdminUserSummary {
  total: number;
  respondents: number;
  creators: number;
  admins: number;
}

export interface AdminUsersResponse {
  items: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  summary: AdminUserSummary;
}

export interface AdminUserQuery {
  page: number;
  search: string;
  role: AdminRoleFilter;
}

export interface AdminRoleChange {
  id: number;
  actor_id: string;
  actor_email: string | null;
  target_id: string;
  target_email: string | null;
  old_role: EditableRole;
  new_role: EditableRole;
  reason: string | null;
  changed_at: string;
}

export interface ChangeRoleRequest {
  userId: string;
  role: EditableRole;
  reason?: string;
}

export interface ChangeRoleResult {
  id: string;
  role: EditableRole;
  changed: boolean;
}
