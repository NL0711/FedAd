"""Run the dashboard API: python -m fedad.web [--port 8000] [--lan].

Default binds to localhost only. ``--lan`` binds to all interfaces so a phone on the same Wi-Fi can join the live campaign
(/v1/* and the phone page). Admin endpoints (/api/*) stay localhost-only either way. Plain HTTP: do this on a network you
trust, for a demo, not on the internet. Windows will ask to allow Python through the firewall for private networks.
"""

import argparse
import os
from pathlib import Path

import uvicorn


def load_env(path: Path) -> None:
    """Read KEY=VALUE lines from backend/.env (git-ignored) into the environment. Real environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


if __name__ == "__main__":
    load_env(Path(__file__).resolve().parents[3] / ".env")
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=None)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--lan", action="store_true", help="listen on all interfaces so a phone can join")
    a = ap.parse_args()
    host = a.host or ("0.0.0.0" if a.lan else "127.0.0.1")
    if a.lan:
        os.environ["FEDAD_LAN"] = "1"
        print("LAN mode: phones on this network can reach /v1/* and the phone page. Admin stays on http://localhost:%d" % a.port)
    uvicorn.run("fedad.web.app:app", host=host, port=a.port, log_level="info")
