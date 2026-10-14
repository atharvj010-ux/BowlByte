import { type NextRequest, NextResponse } from "next/server";

const hopByHop = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const base = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8010";
  const target = new URL(`/api/v1/${path.join("/")}`, base);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (hopByHop.has(lower) || lower.startsWith("x-bowlbyte-")) {
      return;
    }
    headers.set(key, value);
  });
  const secret = process.env.PROXY_SHARED_SECRET;
  if (secret) {
    headers.set("x-bowlbyte-proxy", secret);
    headers.set("x-bowlbyte-client", "web");
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "set-cookie" || hopByHop.has(lower)) {
      return;
    }
    responseHeaders.set(key, value);
  });
  responseHeaders.set("cache-control", "private, no-store");
  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
