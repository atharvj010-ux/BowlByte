"use client";

import { z } from "zod";

import { apiFetch, readError } from "@/lib/auth";

export type PushSupport =
  | { kind: "supported" }
  | { kind: "unsupported"; reason: "no-service-worker" | "no-push" | "ios-needs-install" | "insecure" };

export type PushStatus =
  | { state: "checking" }
  | { state: "unsupported"; message: string }
  | { state: "needs-install"; message: string }
  | { state: "blocked"; message: string }
  | { state: "permission"; message: string }
  | { state: "off" }
  | { state: "error"; message: string }
  | { state: "on" };

export type PushDiagnostics = {
  status: PushStatus;
  browserNotifications: boolean;
  secureContext: boolean;
  serviceWorker: "active" | "inactive" | "missing";
  pushApi: boolean;
  permission: NotificationPermission | "unsupported";
  browserSubscription: "present" | "missing";
  backendSubscription: "active" | "missing" | "unknown";
};

const publicKeySchema = z.object({ supported: z.boolean(), public_key: z.string().nullable() });

const optInKey = (userId: string) => `bowlbyte.push.optin.${userId}`;

export function isIos(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") {
    return { kind: "unsupported", reason: "no-service-worker" };
  }
  if (!window.isSecureContext) {
    return { kind: "unsupported", reason: "insecure" };
  }
  if (!("serviceWorker" in navigator)) {
    return { kind: "unsupported", reason: "no-service-worker" };
  }
  if (!("PushManager" in window) || !("Notification" in window)) {
    // iPhone browsers only expose Web Push to an app added to the Home Screen.
    return { kind: "unsupported", reason: isIos() && !isStandalone() ? "ios-needs-install" : "no-push" };
  }
  return { kind: "supported" };
}

export function unsupportedMessage(reason: Extract<PushSupport, { kind: "unsupported" }>["reason"]): string {
  switch (reason) {
    case "ios-needs-install":
      return "To receive BowlByte alerts on iPhone, add BowlByte to your Home Screen, open the installed app, and enable notifications. This needs iOS 16.4 or later.";
    case "insecure":
      return "Notifications need a secure (HTTPS) connection. They are not available on this address.";
    case "no-service-worker":
    case "no-push":
      return "This browser does not support push notifications. You will still see updates inside BowlByte.";
  }
}

export function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

function deviceLabel(): string {
  const agent = navigator.userAgent;
  if (/iPhone/.test(agent)) return "iPhone";
  if (/iPad/.test(agent)) return "iPad";
  if (/Android/.test(agent)) return "Android phone";
  if (/Windows/.test(agent)) return "Windows computer";
  if (/Mac/.test(agent)) return "Mac";
  if (/Linux/.test(agent)) return "Linux computer";
  return "This device";
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (pushSupport().kind === "unsupported" && !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  } catch {
    return null;
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

export function hasOptedIn(userId: string): boolean {
  try {
    return window.localStorage.getItem(optInKey(userId)) === "1";
  } catch {
    return false;
  }
}

function setOptIn(userId: string, value: boolean) {
  try {
    if (value) {
      window.localStorage.setItem(optInKey(userId), "1");
    } else {
      window.localStorage.removeItem(optInKey(userId));
    }
  } catch {
    // Private mode: the choice simply is not remembered.
  }
}

async function serviceWorkerState(): Promise<PushDiagnostics["serviceWorker"]> {
  if (!("serviceWorker" in navigator)) {
    return "missing";
  }
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) {
    return "missing";
  }
  return registration.active ? "active" : "inactive";
}

async function backendHasEndpoint(endpoint: string): Promise<boolean> {
  const response = await apiFetch("/api/v1/push/subscriptions/confirm", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return z.object({ active: z.boolean() }).parse(await response.json()).active;
}

export async function readPushDiagnostics(userId: string): Promise<PushDiagnostics> {
  const support = pushSupport();
  const base = {
    browserNotifications: typeof window !== "undefined" && "Notification" in window,
    secureContext: typeof window !== "undefined" && window.isSecureContext,
    serviceWorker: "missing" as PushDiagnostics["serviceWorker"],
    pushApi: typeof window !== "undefined" && "PushManager" in window,
    permission: ("Notification" in window ? Notification.permission : "unsupported") as PushDiagnostics["permission"],
    browserSubscription: "missing" as const,
    backendSubscription: "unknown" as const,
  };
  if (support.kind === "unsupported") {
    const status: PushStatus =
      support.reason === "ios-needs-install"
        ? { state: "needs-install", message: unsupportedMessage(support.reason) }
        : { state: "unsupported", message: unsupportedMessage(support.reason) };
    return { ...base, status };
  }
  base.serviceWorker = await serviceWorkerState();
  const response = await apiFetch("/api/v1/push/public-key");
  if (!response.ok) {
    return { ...base, status: { state: "error", message: await readError(response) } };
  }
  const key = publicKeySchema.parse(await response.json());
  if (!key.supported) {
    return {
      ...base,
      status: {
        state: "error",
        message: "Phone notifications are not set up on this server yet. In-app notifications still work.",
      },
    };
  }
  if (Notification.permission === "denied") {
    return {
      ...base,
      status: {
        state: "blocked",
        message: "Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.",
      },
    };
  }
  const subscription = await currentSubscription();
  if (!subscription) {
    if (Notification.permission === "default") {
      return {
        ...base,
        status: {
          state: "permission",
          message: "BowlByte will ask for permission only after you tap Enable Phone Notifications.",
        },
      };
    }
    return { ...base, backendSubscription: "missing", status: { state: "off" } };
  }
  let active = false;
  try {
    active = await backendHasEndpoint(subscription.endpoint);
  } catch (error) {
    return {
      ...base,
      browserSubscription: "present",
      status: {
        state: "error",
        message: error instanceof Error ? error.message : "BowlByte could not confirm this device.",
      },
    };
  }
  if (!active || !hasOptedIn(userId)) {
    return {
      ...base,
      browserSubscription: "present",
      backendSubscription: active ? "active" : "missing",
      status: {
        state: "error",
        message: active
          ? "This browser is subscribed, but it is not the account that turned notifications on. Enable them again for this account."
          : "Permission is on, but BowlByte did not save this device. Enable notifications again.",
      },
    };
  }
  return {
    ...base,
    browserSubscription: "present",
    backendSubscription: "active",
    status: { state: "on" },
  };
}

export async function readPushStatus(userId: string): Promise<PushStatus> {
  return (await readPushDiagnostics(userId)).status;
}

async function sendSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const response = await apiFetch("/api/v1/push/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      expiration_time: json.expirationTime ?? null,
      device_label: deviceLabel(),
    }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const saved = z.object({ subscription: z.object({ enabled: z.boolean() }) }).parse(await response.json());
  if (!saved.subscription.enabled) {
    throw new Error("BowlByte did not save this device.");
  }
}

/** User-initiated. Browsers require the permission prompt to follow a click or tap. */
export async function enablePush(userId: string): Promise<void> {
  const support = pushSupport();
  if (support.kind === "unsupported") {
    throw new Error(unsupportedMessage(support.reason));
  }
  const response = await apiFetch("/api/v1/push/public-key");
  const key = publicKeySchema.parse(await response.json());
  if (!key.supported || !key.public_key) {
    throw new Error("Phone notifications are not set up on this server yet.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked. Allow them in your browser settings to turn this on."
        : "Notifications were not allowed.",
    );
  }
  const subscription = await ensureSubscription(key.public_key);
  await sendSubscription(subscription);
  setOptIn(userId, true);
}

async function ensureSubscription(publicKey: string): Promise<PushSubscription> {
  await registerServiceWorker();
  const ready = await navigator.serviceWorker.ready;
  const existing = await ready.pushManager.getSubscription();
  if (existing) {
    return existing;
  }
  return ready.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToBytes(publicKey),
  });
}

export async function disablePush(userId: string): Promise<void> {
  const subscription = await currentSubscription();
  setOptIn(userId, false);
  if (!subscription) {
    return;
  }
  const endpoint = subscription.endpoint;
  // Unsubscribing in the browser always works offline and ends delivery to this device.
  await subscription.unsubscribe();
  try {
    await apiFetch("/api/v1/push/subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    // The push service will answer 404/410 for the dead endpoint and the server disables it.
  }
}

/** Re-send an existing subscription after sign-in so the server row follows the signed-in user. */
export async function resyncPush(userId: string): Promise<void> {
  if (pushSupport().kind === "unsupported" || Notification.permission !== "granted") {
    return;
  }
  if (!hasOptedIn(userId)) {
    return;
  }
  const response = await apiFetch("/api/v1/push/public-key");
  if (!response.ok) {
    return;
  }
  const key = publicKeySchema.parse(await response.json());
  if (!key.supported || !key.public_key) {
    return;
  }
  // Permission was already granted by this user, so no prompt appears here.
  await sendSubscription(await ensureSubscription(key.public_key));
}

/** Called before logout so the next person on a shared device receives nothing meant for this user. */
export async function releaseDeviceForLogout(): Promise<void> {
  if (typeof window === "undefined" || pushSupport().kind === "unsupported") {
    return;
  }
  try {
    const subscription = await currentSubscription();
    if (!subscription) {
      return;
    }
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await apiFetch("/api/v1/push/subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    }).catch(() => undefined);
  } catch {
    // Logout must never be blocked by notification clean-up.
  }
}

export type TestPushResult = {
  acceptance: "accepted" | "rejected" | "unknown";
};

export async function sendTestPush(): Promise<TestPushResult> {
  const response = await apiFetch("/api/v1/push/test", { method: "POST" });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const queued = z.object({ event_id: z.string() }).parse(await response.json());
  const statusSchema = z.object({ push_service: z.enum(["accepted", "rejected", "unknown"]) });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const status = await apiFetch(`/api/v1/push/test/${queued.event_id}`);
    if (!status.ok) {
      continue;
    }
    const body = statusSchema.parse(await status.json());
    if (body.push_service !== "unknown") {
      return { acceptance: body.push_service };
    }
  }
  return { acceptance: "unknown" };
}
