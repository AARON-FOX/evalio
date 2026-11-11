// Handles both FetchBaseQueryError and SerializedError without assuming shape.
export function queryErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    if ("data" in error) {
      const value = error.data;
      if (
        value &&
        typeof value === "object" &&
        "message" in value &&
        typeof value.message === "string"
      )
        return value.message;
    }
    if ("error" in error && typeof error.error === "string") return error.error;
    if ("message" in error && typeof error.message === "string")
      return error.message;
  }
  return "Не вдалося отримати дані від сервера.";
}
