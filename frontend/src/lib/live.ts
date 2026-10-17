"use client";

import { useEffect, useState } from "react";

export type LiveState = "connecting" | "live" | "polling";

export function useLiveResource(path: string, onSignal: () => void, enabled = true): LiveState {
  const [state, setState] = useState<LiveState>("connecting");

  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let reconnect = 0;
    let attempt = 0;

    function connect() {
      if (!enabled) {
        return;
      }
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}${path}`);
      socket.onopen = () => {
        attempt = 0;
        setState("live");
        onSignal();
      };
      socket.onmessage = () => onSignal();
      socket.onerror = () => setState("polling");
      socket.onclose = () => {
        setState("polling");
        if (stopped) {
          return;
        }
        const delay = Math.min(15_000, 1000 * 2 ** attempt);
        attempt += 1;
        reconnect = window.setTimeout(connect, delay);
      };
    }

    if (enabled) {
      connect();
    }
    const poll = window.setInterval(() => {
      if (enabled && socket?.readyState !== WebSocket.OPEN) {
        onSignal();
      }
    }, 4000);
    return () => {
      stopped = true;
      window.clearTimeout(reconnect);
      window.clearInterval(poll);
      socket?.close();
    };
  }, [enabled, onSignal, path]);

  return state;
}
