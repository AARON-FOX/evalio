import { useEffect, useState } from "react";
import {
  getDatabaseHealth,
  type DatabaseHealthResponse,
} from "../services/api";

export function DatabaseStatus() {
  const [data, setData] = useState<DatabaseHealthResponse | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    getDatabaseHealth(controller.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;

        setError(err instanceof Error ? err.message : "Unknown error");
      });

    return () => controller.abort();
  }, []);

  return (
    <section>
      <h2>Database connection</h2>

      {!data && !error && <p>Connecting to Supabase...</p>}

      {error && <p role="alert">Error: {error}</p>}

      {data && (
        <>
          <p>Status: {data.status}</p>
          <p>Source: {data.source}</p>
          <p>Message: {data.data.message}</p>
        </>
      )}
    </section>
  );
}
