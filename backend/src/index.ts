import "dotenv/config";
import express from "express";
import cors from "cors";
import { supabase } from "./lib/supabase.js";
import { createClient } from "@supabase/supabase-js";
import { testsRouter } from "./routes/tests.js";
import { submissionsRouter } from "./routes/submissions.js";

const app = express();

const PORT = Number(process.env.PORT ?? 3001);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

// Middleware
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Evalio API is running",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/db-health", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("app_status")
      .select("name, message")
      .eq("name", "evalio")
      .single();

    if (error) {
      console.error("Supabase error:", error);

      res.status(502).json({
        status: "error",
        message: "Database request failed",
      });
      return;
    }

    res.status(200).json({
      status: "ok",
      source: "supabase",
      data,
    });
  } catch (error) {
    console.error("Database connection error:", error);

    res.status(502).json({
      status: "error",
      message: "Database connection failed",
    });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    const authorization = req.header("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({
        message: "Authentication required",
      });
      return;
    }

    const token = authorization.slice(7).trim();

    // Validate the JWT through Supabase Auth
    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !authData.user) {
      res.status(401).json({
        message: "Invalid or expired token",
      });
      return;
    }

    const user = authData.user;

    // Run the database query as this user,
    // so PostgreSQL applies their RLS policies
    const userClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("Profile error:", profileError);

      res.status(500).json({
        message: "Could not load user profile",
      });
      return;
    }

    res.status(200).json({
      id: user.id,
      email: user.email ?? null,
      role: profile.role,
    });
  } catch (error) {
    console.error("Authentication error:", error);

    res.status(500).json({
      message: "Internal server error",
    });
  }
});

app.use("/api/tests", testsRouter);
app.use("/api/submissions", submissionsRouter);

import type { ErrorRequestHandler } from "express";

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error("Unhandled API error:", error);

  res.status(500).json({
    message: "Internal server error",
  });
};

app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Evalio API: http://localhost:${PORT}`);
});
