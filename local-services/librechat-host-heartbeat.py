#!/usr/bin/env python3
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ["HEARTBEAT_TOKEN"]
EXPECTED_PATH = f"/{TOKEN}"
BODY = b"librechat-pve2-alive\n"

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?", 1)[0] != EXPECTED_PATH:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(BODY)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(BODY)

    def log_message(self, _format, *_args):
        return

ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("HEARTBEAT_PORT", "9199"))), Handler).serve_forever()
