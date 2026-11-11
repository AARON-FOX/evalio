import { Router } from "express";
import { z } from "zod";

import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  search: z.string().trim().max(100).default(""),
  role: z.enum(["all", "respondent", "creator", "admin"]).default("all"),
});
const roleInputSchema = z
  .object({
    role: z.enum(["respondent", "creator"]),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();
const uuidSchema = z.string().uuid();

function handleRpcError(message: string): { status: number; message: string } {
  if (message.includes("admin_required"))
    return { status: 403, message: "Admin privileges required" };
  if (message.includes("target_not_found"))
    return { status: 404, message: "User not found" };
  if (message.includes("cannot_change_self"))
    return { status: 409, message: "You cannot change your own role" };
  if (message.includes("cannot_change_admin"))
    return { status: 409, message: "Another administrator cannot be changed" };
  if (message.includes("user_has_active_attempt"))
    return {
      status: 409,
      message:
        "User must complete their active test attempt before changing role",
    };
  if (
    message.includes("invalid_role_change") ||
    message.includes("invalid_admin_query")
  ) {
    return { status: 400, message: "Invalid input" };
  }
  return { status: 502, message: "Could not process admin request" };
}

// GET /api/admin/users?page=1&search=...&role=all|respondent|creator|admin
adminRouter.get("/users", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid users query" });
    return;
  }
  const { page, search, role } = parsed.data;
  const { data, error } = await supabaseAdmin.rpc("evalio_admin_list_users", {
    p_actor_id: req.authUser!.id,
    p_search: search,
    p_role: role === "all" ? null : role,
    p_page: page,
    p_page_size: 20,
  });
  if (error) {
    console.error("Admin list users RPC error:", error);
    const mapped = handleRpcError(error.message);
    res.status(mapped.status).json({ message: mapped.message });
    return;
  }
  res.json(data);
});

// PATCH /api/admin/users/:userId/role
adminRouter.patch("/users/:userId/role", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.userId);
  const body = roleInputSchema.safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ message: "Invalid role change" });
    return;
  }
  const { data, error } = await supabaseAdmin.rpc("evalio_admin_change_role", {
    p_actor_id: req.authUser!.id,
    p_target_id: id.data,
    p_new_role: body.data.role,
    p_reason: body.data.reason ?? null,
  });
  if (error) {
    console.error("Admin role change RPC error:", error);
    const mapped = handleRpcError(error.message);
    res.status(mapped.status).json({ message: mapped.message });
    return;
  }
  res.json(data);
});

// GET /api/admin/audit - last 20 role changes
adminRouter.get("/audit", async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc("evalio_admin_role_audit", {
    p_actor_id: req.authUser!.id,
    p_limit: 20,
  });
  if (error) {
    console.error("Admin audit RPC error:", error);
    const mapped = handleRpcError(error.message);
    res.status(mapped.status).json({ message: mapped.message });
    return;
  }
  res.json(data);
});
