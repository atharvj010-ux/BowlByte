import { type NextRequest, NextResponse } from "next/server";

import { backendUrl } from "@/lib/backend-origin";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  const target = backendUrl(`/api/v1/${path.join("/")}`);
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
    headers.set("x-bowlbyte-client", trustedClientAddress(request));
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.name : "UpstreamError";
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "The API could not be reached. Try again in a moment.",
          details: { reason: detail },
        },
      },
      { status: 502, headers: { "cache-control": "private, no-store" } },
    );
  }

  // Buffer the body. Streaming upstream.body through Next on Vercel can drop
  // mid-response and surface as a browser "Failed to fetch" on the menu.
  const payload = await upstream.arrayBuffer();
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "set-cookie" || hopByHop.has(lower)) {
      return;
    }
    responseHeaders.set(key, value);
  });
  responseHeaders.set("cache-control", "private, no-store");
  const response = new NextResponse(payload, {
    status: upstream.status,
    headers: responseHeaders,
  });
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

function isIp(value: string): boolean {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255);
  }
  return value.includes(":") && /^[0-9a-fA-F:]+$/.test(value);
}

function trustedClientAddress(request: NextRequest): string {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = request.headers.get("x-forwarded-for") ?? "";
    const hops = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const appended = hops.at(-1) ?? "";
    if (isIp(appended)) {
      return appended;
    }
  }
  // Next.js 16 route handlers do not expose the TCP peer. 0.0.0.0 is the
  // shared fallback when the trusted proxy does not append a client address.
  // Per-email login limits still apply. Staging sets TRUST_PROXY=true.
  return "0.0.0.0";
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
