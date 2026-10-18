"""Local SMTP capture with the Mailpit search endpoints used by Playwright.

This process never sends mail onward. It only stores synthetic test messages.
"""

from __future__ import annotations

import asyncio
import json
from email import message_from_bytes
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from uuid import uuid4

messages: list[dict[str, str]] = []


class Capture(asyncio.Protocol):
    def __init__(self) -> None:
        self.buffer = bytearray()
        self.collecting = False
        self.transport: asyncio.Transport | None = None

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self.transport = transport  # type: ignore[assignment]
        self.transport.write(b"220 bowlbyte-e2e.local ESMTP\r\n")

    def data_received(self, data: bytes) -> None:
        self.buffer.extend(data)
        while True:
            if self.collecting:
                marker = b"\r\n.\r\n"
                end = self.buffer.find(marker)
                if end < 0:
                    return
                raw = bytes(self.buffer[:end])
                del self.buffer[: end + len(marker)]
                self.collecting = False
                self._store(raw)
                assert self.transport is not None
                self.transport.write(b"250 Ok\r\n")
                continue
            newline = self.buffer.find(b"\r\n")
            if newline < 0:
                return
            line = bytes(self.buffer[:newline]).decode("utf-8", errors="replace")
            del self.buffer[: newline + 2]
            self._command(line)

    def _command(self, line: str) -> None:
        assert self.transport is not None
        verb = line.split(" ", 1)[0].upper()
        if verb in {"EHLO", "HELO"}:
            self.transport.write(b"250 bowlbyte-e2e.local\r\n")
        elif verb in {"MAIL", "RCPT", "NOOP", "RSET"}:
            self.transport.write(b"250 Ok\r\n")
        elif verb == "DATA":
            self.collecting = True
            self.transport.write(b"354 End data with <CR><LF>.<CR><LF>\r\n")
        elif verb == "QUIT":
            self.transport.write(b"221 Bye\r\n")
            self.transport.close()
        else:
            self.transport.write(b"250 Ok\r\n")

    def _store(self, raw: bytes) -> None:
        parsed = message_from_bytes(raw, policy=default)
        text = parsed.get_body(preferencelist=("plain", "html"))
        content = text.get_content() if text is not None else raw.decode("utf-8", errors="replace")
        messages.append({"ID": uuid4().hex, "To": parsed.get("To", ""), "Text": content})


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/api/v1/search":
            query = ""
            if "query=" in self.path:
                query = self.path.split("query=", 1)[1].split("&", 1)[0]
                query = query.replace("%3A", ":").replace("%40", "@")
            target = query.split("to:", 1)[-1] if "to:" in query else ""
            found = [
                {"ID": item["ID"]}
                for item in messages
                if target.lower() in item["To"].lower() or target.lower() in item["Text"].lower()
            ]
            body = json.dumps({"messages": found}).encode()
        elif path.startswith("/api/v1/message/"):
            wanted = path.rsplit("/", 1)[-1]
            item = next((row for row in messages if row["ID"] == wanted), None)
            body = json.dumps({"Text": "" if item is None else item["Text"]}).encode()
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args) -> None:
        return


async def main() -> None:
    loop = asyncio.get_running_loop()
    await loop.create_server(Capture, "127.0.0.1", 1025)
    httpd = ThreadingHTTPServer(("127.0.0.1", 8025), Handler)
    Thread(target=httpd.serve_forever, daemon=True).start()
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
