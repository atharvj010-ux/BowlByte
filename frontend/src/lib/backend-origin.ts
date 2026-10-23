const LOCAL_BACKEND = "http://127.0.0.1:8010";

/**
 * Base URL of the FastAPI service.
 * On Vercel this is the frontend service binding `API_INTERNAL_URL`.
 * The lookup is dynamic so Next.js does not inline the value at build time.
 * Bindings exist only while a server function is running.
 */
export function backendOrigin(): string {
  const configured = process.env["API_INTERNAL_URL"]?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const legacy = process.env["NEXT_PUBLIC_API_URL"]?.trim();
  if (legacy && typeof window === "undefined") {
    return legacy.replace(/\/+$/, "");
  }
  return LOCAL_BACKEND;
}

/** Join an API path onto the bound service origin. A leading slash is optional. */
export function backendUrl(path: string): URL {
  return new URL(path.replace(/^\/+/, ""), `${backendOrigin()}/`);
}
