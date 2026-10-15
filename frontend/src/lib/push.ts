"use client";

import { z } from "zod";

import { apiFetch, readError } from "@/lib/auth";

export type PushSupport =
  | { kind: "supported" }
  | { kind: "unsupported"; reason: "no-service-worker" | "no-push" | "ios-needs-install" | "insecure" };

export type PushStatus =
  | { state: "checking" }
  | { state: "unsupported"; message: string }
  | { state: "server-off"; message: string }
  | { state: "blocked"; message: string }
  | { state: "off" }
  | { state: "on"; endpointKnown: boolean };

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
      return "On iPhone, add BowlByte to your Home Screen first (Share, then Add to Home Screen), open it from there, then turn notifications on. This needs iOS 16.4 or later.";
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

export async function readPushStatus(userId: string): Promise<PushStatus> {
  const support = pushSupport();
  if (support.kind === "unsupported") {
    return { state: "unsupported", message: unsupportedMessage(support.reason) };
  }
  const response = await apiFetch("/api/v1/push/public-key");
  if (!response.ok) {
    return { state: "server-off", message: await readError(response) };
  }
  const key = publicKeySchema.parse(await response.json());
  if (!key.supported) {
    return {
      state: "server-off",
      message: "Phone notifications are not set up on this server yet. In-app notifications still work.",
    };
  }
  if (Notification.permission === "denied") {
    return {
      state: "blocked",
      message:
        "Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.",
    };
  }
  const subscription = await currentSubscription();
  if (subscription && hasOptedIn(userId)) {
    return { state: "on", endpointKnown: true };
  }
  return { state: "off" };
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

export async function sendTestPush(): Promise<void> {
  const response = await apiFetch("/api/v1/push/test", { method: "POST" });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
}
