#!/usr/bin/env python3

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "18080"))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        payload = {
            "runtime": "python",
            "message": "hello from docker",
            "path": self.path,
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        print(f"[python-http] {self.address_string()} - {format % args}")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"python server listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
