"""HTTP API of the coordinator (standard library only). Wire contract for the Flutter app:

  GET  /v1/model    -> {version, weights[], n_params, spec_hash, mode, policy{clip_c, top_k, dp, eps_per_upload,
                        delta_per_upload, max_uploads, local_epochs, lr, batch}, prototype}
  POST /v1/updates  Authorization: Bearer <token>
                    {"base_version": int, "n": int, "loss_before": float, "loss_after": float, "blob": base64}
                    -> {accepted, version, model_stepped}      errors: 400 malformed, 401 bad token, 409 stale or
                       duplicate, 413 too large, 429 upload budget used
  GET  /v1/status   -> {version, buffered, buffer_k, mode, rounds_done, prototype}

The client id is taken from the token, never from the body. ``blob`` is produced by ``compress.encode`` (see
``aggregation/compress.py``) after clipping and noising on the device.

What this is not: tokens are a static allowlist (no registration, rotation or attestation), a token stolen from a device
allows impersonation; no rate limiting beyond the per-client upload budget; no persistence; TLS only if you pass
``certfile``/``keyfile`` (otherwise plain HTTP, fine for localhost, NOT for the internet). Prototype.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import json
import ssl
import struct
import threading
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, Optional

import numpy as np

from ..aggregation import compress
from ..federation.coordinator import Coordinator, Rejected
from ..federation.pipeline import Upload

MAX_BODY = 256 * 1024


def _make_handler(coord: Coordinator, tokens: Dict[str, int]):
    class Handler(BaseHTTPRequestHandler):
        server_version = "FedAd/0.1"

        def log_message(self, *a):          # quiet; do not log tokens or bodies
            pass

        def _send(self, code: int, obj: dict) -> None:
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _client(self) -> Optional[int]:
            auth = self.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                return None
            given = auth[7:]
            found = None
            for tok, cid in tokens.items():             # compare against all, constant-time each
                if hmac.compare_digest(tok, given):
                    found = cid
            return found

        def do_GET(self):
            if self.path == "/v1/model":
                self._send(200, coord.model())
            elif self.path == "/v1/status":
                self._send(200, coord.status())
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/v1/updates":
                return self._send(404, {"error": "not found"})
            cid = self._client()
            if cid is None:
                return self._send(401, {"error": "bad token"})
            try:
                length = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                length = -1
            if length < 0:
                return self._send(400, {"error": "Content-Length required"})
            if length > MAX_BODY:
                left = min(length, 8 * MAX_BODY)      # drain a bounded amount so the client sees the 413, not a reset
                while left > 0:
                    chunk = self.rfile.read(min(65536, left))
                    if not chunk:
                        break
                    left -= len(chunk)
                self.close_connection = True
                return self._send(413, {"error": "body too large"})
            try:
                d = json.loads(self.rfile.read(length))
                up = Upload(cid, base64.b64decode(d["blob"], validate=True), int(d["n"]), float(d["loss_before"]),
                            float(d["loss_after"]), int(d["base_version"]))
                if up.n <= 0 or not all(np.isfinite([up.loss_before, up.loss_after])) or up.loss_before <= 0:
                    raise ValueError("bad numbers")
                vec = compress.decode(up.blob)
                if vec.size != coord.w.size or not np.all(np.isfinite(vec)):
                    raise ValueError("wrong length or non-finite update")
            except (KeyError, ValueError, TypeError, IndexError, binascii.Error, zlib.error, struct.error) as e:
                return self._send(400, {"error": f"malformed: {type(e).__name__}"})
            try:
                self._send(200, coord.submit(up))
            except Rejected as r:
                self._send(r.code, {"error": r.message})

    return Handler


def make_server(coord: Coordinator, tokens: Dict[str, int], host: str = "127.0.0.1", port: int = 0,
                certfile: Optional[str] = None, keyfile: Optional[str] = None) -> ThreadingHTTPServer:
    """``tokens`` maps secret bearer token -> client id. Keep tokens out of the repo (environment or a secrets store)."""
    srv = ThreadingHTTPServer((host, port), _make_handler(coord, tokens))
    if certfile:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile, keyfile)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    return srv


def serve_in_thread(srv: ThreadingHTTPServer) -> threading.Thread:
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return t
