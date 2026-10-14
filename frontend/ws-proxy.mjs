import http from "node:http";
import net from "node:net";

const publicPort = Number(process.env.PORT || 3000);
const internalPort = publicPort + 100;
const hostname = process.env.HOSTNAME || "0.0.0.0";
process.env.PORT = String(internalPort);
process.env.HOSTNAME = "127.0.0.1";

await import("./server.js");

const api = new URL(process.env.API_INTERNAL_URL || "http://127.0.0.1:8010");

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
  if (!request.url?.startsWith("/api/v1/ws")) {
    socket.destroy();
    return;
  }
  const upstream = net.connect(Number(api.port || 80), api.hostname, () => {
    const headerLines = [
      `GET ${request.url} HTTP/1.1`,
      `Host: ${api.host}`,
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
});

proxy.listen(publicPort, hostname);
