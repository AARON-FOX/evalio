import type { RequestHandler } from "express";

import { supabase } from "../lib/supabase.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const authorization = req.header("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({
        message: "Authentication required",
      });
      return;
    }

    const token = authorization.slice(7).trim();

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      res.status(401).json({
        message: "Invalid or expired token",
      });
      return;
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (!profile || !["creator", "respondent"].includes(profile.role)) {
      res.status(403).json({
        message: "User profile is not available",
      });
      return;
    }

    req.authUser = {
      id: data.user.id,
      role: profile.role as "creator" | "respondent",
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const requireCreator: RequestHandler = (req, res, next) => {
  if (req.authUser?.role !== "creator") {
    res.status(403).json({
      message: "Creator role required",
    });
    return;
  }

  next();
};
