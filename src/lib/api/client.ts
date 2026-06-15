export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return fallback;
  }

  const error = payload.error;
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return fallback;

  for (const value of Object.values(error)) {
    if (Array.isArray(value) && typeof value[0] === "string") {
      return value[0];
    }
  }
  return fallback;
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new ApiError(
      errorMessage(payload, `请求失败 (${response.status})`),
      response.status,
      payload
    );
  }

  return payload as T;
}
