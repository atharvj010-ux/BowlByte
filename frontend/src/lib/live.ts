"use client";

import { useEffect, useRef, useState } from "react";

export type LiveState = "live" | "reconnecting" | "polling" | "offline";

const PRIVATE_CLOSE = new Set([1008, 4401, 4403]);

type Pool = {
  path: string;
  socket: WebSocket | null;
  listeners: Set<() => void>;
  subscribers: Set<(state: LiveState) => void>;
  attempt: number;
  timer: number;
  releaseTimer: number;
  poll: number;
  stopped: boolean;
  healthy: boolean;
  state: LiveState;
  onStorage: (event: StorageEvent) => void;
  onSessionEnd: () => void;
};

const pools = new Map<string, Pool>();

export function liveStatusLabel(state: LiveState): string {
  switch (state) {
    case "live":
      return "Live updates connected";
    case "reconnecting":
      return "Reconnecting";
    case "polling":
      return "Polling for updates";
    case "offline":
      return "Offline";
  }
}

function emit(pool: Pool, state: LiveState) {
  pool.state = state;
  for (const subscriber of pool.subscribers) {
    subscriber(state);
  }
}

function signal(pool: Pool) {
  for (const listener of pool.listeners) {
    listener();
  }
}

function connect(pool: Pool) {
  if (pool.stopped || pool.listeners.size === 0) {
    return;
  }
  if (
    pool.socket &&
    (pool.socket.readyState === WebSocket.OPEN || pool.socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  emit(pool, "reconnecting");
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}${pool.path}`);
  pool.socket = socket;
  socket.onopen = () => {
    if (pool.socket !== socket) {
      return;
    }
    pool.attempt = 0;
    emit(pool, "live");
    signal(pool);
  };
  socket.onmessage = () => {
    if (pool.socket === socket) {
      signal(pool);
    }
  };
  socket.onclose = (event) => {
    if (pool.socket !== socket) {
      return;
    }
    pool.socket = null;
    if (pool.stopped || pool.listeners.size === 0) {
      return;
    }
    if (PRIVATE_CLOSE.has(event.code)) {
      pool.stopped = true;
      window.clearTimeout(pool.timer);
      emit(pool, "offline");
      return;
    }
    pool.attempt += 1;
    const limited = event.code === 4429 || event.code === 1013;
    const delay = limited ? 15_000 : Math.min(15_000, 1000 * 2 ** Math.min(pool.attempt, 4));
    emit(pool, "reconnecting");
    pool.timer = window.setTimeout(() => connect(pool), delay);
  };
}

function stopPrivate(pool: Pool) {
  pool.stopped = true;
  window.clearTimeout(pool.timer);
  pool.socket?.close();
  emit(pool, "offline");
}

function release(path: string, pool: Pool) {
  pool.stopped = true;
  window.clearTimeout(pool.timer);
  window.clearInterval(pool.poll);
  window.removeEventListener("storage", pool.onStorage);
  window.removeEventListener("bowlbyte-session-end", pool.onSessionEnd);
  pool.socket?.close();
  pool.socket = null;
  pools.delete(path);
}

export function useLiveResource(
  path: string,
  onSignal: () => void,
  enabled = true,
  pollHealthy = true,
): LiveState {
  const [state, setState] = useState<LiveState>(enabled ? "reconnecting" : "offline");
  const signalRef = useRef(onSignal);

  useEffect(() => {
    signalRef.current = onSignal;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let pool = pools.get(path);
    if (!pool || pool.stopped) {
      pool = {
        path,
        socket: null,
        listeners: new Set(),
        subscribers: new Set(),
        attempt: 0,
        timer: 0,
        releaseTimer: 0,
        poll: 0,
        stopped: false,
        healthy: pollHealthy,
        state: "reconnecting",
        onStorage: () => undefined,
        onSessionEnd: () => undefined,
      };
      pool.onSessionEnd = () => {
        if (pool) {
          stopPrivate(pool);
        }
      };
      pool.onStorage = (event) => {
        if (event.key !== "bowlbyte-session-epoch" || !pool) {
          return;
        }
        stopPrivate(pool);
      };
      window.addEventListener("storage", pool.onStorage);
      window.addEventListener("bowlbyte-session-end", pool.onSessionEnd);
      pool.poll = window.setInterval(() => {
        if (!pool || pool.stopped || pool.socket?.readyState === WebSocket.OPEN) {
          return;
        }
        signal(pool);
        if (pool.attempt >= 1) {
          emit(pool, pool.healthy ? "polling" : "offline");
        }
      }, 4000);
      pools.set(path, pool);
    }
    const current = pool;
    window.clearTimeout(current.releaseTimer);
    current.healthy = pollHealthy;
    const listener = () => signalRef.current();
    current.listeners.add(listener);
    current.subscribers.add(setState);
    if (
      !current.socket ||
      current.socket.readyState === WebSocket.CLOSING ||
      current.socket.readyState === WebSocket.CLOSED
    ) {
      connect(current);
    } else {
      queueMicrotask(() => setState(current.state));
    }
    return () => {
      current.listeners.delete(listener);
      current.subscribers.delete(setState);
      if (current.listeners.size > 0) {
        return;
      }
      current.releaseTimer = window.setTimeout(() => {
        if (current.listeners.size === 0) {
          release(path, current);
        }
      }, 0);
    };
    // pollHealthy only changes the fallback label. Reconnecting here would drop the socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, path]);

  useEffect(() => {
    const pool = pools.get(path);
    if (pool) {
      pool.healthy = pollHealthy;
    }
  }, [path, pollHealthy]);

  return enabled ? state : "offline";
}
