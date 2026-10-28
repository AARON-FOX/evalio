const API_BASE_URL = import.meta.env.VITE_API_URL;

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
