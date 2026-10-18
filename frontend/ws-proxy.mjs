import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dev = process.argv.includes("--dev");
const publicPort = Number(process.env.PORT || 3000);
const internalPort = publicPort + 100;
const publicHost = process.env.HOSTNAME || "0.0.0.0";
const root = path.dirname(fileURLToPath(import.meta.url));

if (!dev) {
  process.env.PORT = String(internalPort);
  process.env.HOSTNAME = "127.0.0.1";
  await import("./server.js");
}

const api = new URL(process.env.API_INTERNAL_URL || "http://127.0.0.1:8010");

function tunnel(socket, head, port, hostname, requestTarget, headerHost, request) {
  const upstream = net.connect(port, hostname, () => {
    upstream.setNoDelay(true);
    const headerLines = [
      `GET ${requestTarget} HTTP/1.1`,
      `Host: ${headerHost}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
    ];
    for (const [key, value] of Object.entries(request.headers)) {
      if (!value || ["upgrade", "connection", "host"].includes(key)) {
        continue;
      }
      const text = Array.isArray(value) ? value.join(", ") : value;
      headerLines.push(`${key}: ${text}`);
    }
    headerLines.push("", "");
    upstream.write(headerLines.join("\r\n"));
    if (head?.length) {
      upstream.write(head);
    }
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
}

const proxy = http.createServer((request, response) => {
  const headers = { ...request.headers, host: request.headers.host };
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: internalPort,
      path: request.url,
      method: request.method,
      headers,
    },
    (proxied) => {
      response.writeHead(proxied.statusCode ?? 502, proxied.headers);
      proxied.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502);
    }
    response.end();
  });
  request.pipe(upstream);
});

proxy.on("upgrade", (request, socket, head) => {
  socket.setNoDelay(true);
  const target = request.url ?? "/";
  if (target.startsWith("/api/v1/ws")) {
    tunnel(socket, head, Number(api.port || 80), api.hostname, target, api.host, request);
    return;
  }
  if (dev) {
    tunnel(socket, head, internalPort, "127.0.0.1", target, `127.0.0.1:${internalPort}`, request);
    return;
  }
  socket.destroy();
});

if (dev) {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(internalPort)], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PORT: String(internalPort), HOSTNAME: "127.0.0.1" },
  });
  const stop = () => child.kill();
  process.on("exit", stop);
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });
  child.on("exit", (code) => process.exit(code ?? 1));
  await waitForPort(internalPort);
}

proxy.listen(publicPort, publicHost);

function waitForPort(port) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        tries += 1;
        if (tries > 150) {
          reject(new Error("The Next.js dev server did not open its port."));
          return;
        }
        setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}
