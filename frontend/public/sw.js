/*
 * BowlByte service worker.
 *
 * Two jobs only:
 *   1. show Web Push notifications and open the right page when one is tapped;
 *   2. make the app installable, with a static offline page.
 *
 * It never caches API responses, HTML pages, sessions, order data, receipts, or
 * pickup credentials. The only cached files are the offline page and its icon.
 * Push messages carry no secrets: just a title, a short line, an order id, and a path.
 */

const STATIC_CACHE = "bowlbyte-static-v1";
const STATIC_FILES = ["/offline.html", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// Network only. A failed page navigation falls back to the static offline page.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") {
    return;
  }
  event.respondWith(
    fetch(request).catch(() =>
      caches.match("/offline.html").then(
        (cached) =>
          cached ||
          new Response("BowlByte is offline.", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          }),
      ),
    ),
  );
});

function safePath(value) {
  // Only same-origin app paths are ever opened from a notification.
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/student";
  }
  return /^\/(student|cashier|staff|admin)(\/[A-Za-z0-9\-_/]*)?$/.test(value) ? value : "/student";
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 80) : "BowlByte";
  const body = typeof data.body === "string" ? data.body.slice(0, 200) : "You have an update.";
  const tag = typeof data.tag === "string" && data.tag ? data.tag.slice(0, 80) : "bowlbyte";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: safePath(data.url), type: data.type || null },
      renotify: false,
      requireInteraction: data.type === "ORDER_READY",
      actions: data.type === "ORDER_READY" ? [{ action: "open", title: "View order" }] : [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && "focus" in client) {
          return client.focus().then((focused) => {
            if ("navigate" in focused) {
              return focused.navigate(target.href);
            }
            return focused;
          });
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});

// The browser rotated the subscription. Ask open pages to re-register it with their session.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        client.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED" });
      }
    }),
  );
});
