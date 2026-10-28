import { useEffect, useState } from "react";
import { getApiHealth, type HealthResponse } from "./services/api";
import { DatabaseStatus } from './components/DatabaseStatus';
import "./App.css";

function App() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    getApiHealth(controller.signal)
      .then((response) => {
        setData(response);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;

        setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Evalio</h1>
      <p>Web platform for tests and surveys</p>

      <h2>Backend connection</h2>

      {loading && <p>Connecting to API...</p>}

      {error && <p role="alert">Connection error: {error}</p>}

      {data && (
        <div>
          <p>Status: {data.status}</p>
          <p>Message: {data.message}</p>
          <p>Timestamp: {data.timestamp}</p>
        </div>
      )}
      
      <DatabaseStatus />
    </main>
  );
}

export default App;
