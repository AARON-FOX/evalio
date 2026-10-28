import "dotenv/config";
import express from "express";
import cors from "cors";
import { supabase } from "./lib/supabase.js";

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

// Start server
app.listen(PORT, () => {
  console.log(`Evalio API: http://localhost:${PORT}`);
});
