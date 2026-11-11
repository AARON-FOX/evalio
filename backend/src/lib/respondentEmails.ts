import { supabaseAdmin } from "./supabaseAdmin.js";

// Must only be used after requireCreator AND verifying that the submissions
// belong to a test owned by the requesting creator. Never expose this helper
// through a student or public API.
export async function respondentEmailMap(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))].slice(0, 50);
  const entries = await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
        return [id, error ? null : (data.user?.email ?? null)] as const;
      } catch {
        return [id, null] as const;
      }
    }),
  );
  return new Map<string, string | null>(entries);
}

export async function attachRespondentEmails<
  T extends { respondentId: string },
>(rows: T[]): Promise<(T & { respondentEmail: string | null })[]> {
  const emails = await respondentEmailMap(rows.map((row) => row.respondentId));
  return rows.map((row) => ({
    ...row,
    respondentEmail: emails.get(row.respondentId) ?? null,
  }));
}
