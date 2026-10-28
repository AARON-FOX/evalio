const API_BASE_URL = import.meta.env.VITE_API_URL;

if (!API_BASE_URL) {
  throw new Error("VITE_API_URL is missing. Check frontend/.env.local");
}

export interface HealthResponse {
  status: string;
  message: string;
  timestamp: string;
}

export async function getApiHealth(
  signal?: AbortSignal,
): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/health`, { signal });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return (await response.json()) as HealthResponse;
}

export interface DatabaseHealthResponse {
  status: string;
  source: string;
  data: {
    name: string;
    message: string;
  };
}

export async function getDatabaseHealth(
  signal?: AbortSignal,
): Promise<DatabaseHealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/db-health`, { signal });

  if (!response.ok) {
    throw new Error(`Database API request failed: ${response.status}`);
  }

  return (await response.json()) as DatabaseHealthResponse;
}
