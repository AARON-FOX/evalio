import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;
const MAX_SIZE = 3 * 1024 * 1024;
const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

async function creatorRequest<T>(
  testId: string,
  endpoint: string,
  payload: object,
): Promise<T> {
  if (!API) throw new Error("VITE_API_URL is missing");
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session) throw new Error("Потрібно увійти в акаунт.");

  const response = await fetch(
    `${API}/api/tests/${encodeURIComponent(testId)}/media/${endpoint}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const result: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      result &&
      typeof result === "object" &&
      "message" in result &&
      typeof result.message === "string"
        ? result.message
        : "Не вдалося завантажити зображення.";

    throw new Error(message);
  }

  return result as T;
}

// UUID paths are immutable; replace by uploading a NEW file and saving its path.
// Old objects can still be referenced by the previously published version.
export async function uploadTestImage(testId: string, file: File) {
  if (!allowed.has(file.type) || file.size > MAX_SIZE || file.size === 0) {
    throw new Error("Дозволено JPG, PNG, WebP та GIF розміром до 3 МБ.");
  }

  const { path, token } = await creatorRequest<{ path: string; token: string }>(
    testId,
    "upload-token",
    { mimeType: file.type, size: file.size },
  );

  const { error } = await supabase.storage
    .from("evalio-test-images")
    .uploadToSignedUrl(path, token, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error)
    throw new Error(`Не вдалося завантажити зображення: ${error.message}`);

  const { imageUrl } = await creatorRequest<{ imageUrl: string }>(
    testId,
    "preview-url",
    { path },
  );

  return { imagePath: path, imageUrl };
}
