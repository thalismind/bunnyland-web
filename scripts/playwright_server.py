"""Shared static-server bootstrap for local Playwright regressions."""

from __future__ import annotations

import atexit
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def _url_ok(url: str, *, timeout: float) -> bool:
    try:
        request = urllib.request.Request(
            url, headers={"User-Agent": "Bunnyland-Playwright/1.0"}
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return 200 <= response.status < 400
    except (OSError, urllib.error.URLError):
        return False


def ensure_web_server(base_url: str) -> None:
    """Ensure the local static web server is reachable for direct script runs."""
    check_url = f"{base_url.rstrip('/')}/index.html"
    parsed = urllib.parse.urlparse(base_url)
    local_host = parsed.hostname in {"127.0.0.1", "localhost"}
    if _url_ok(check_url, timeout=0.5 if local_host else 5.0):
        return
    if os.environ.get("BUNNYLAND_WEB_NO_SERVER") == "1":
        raise RuntimeError(
            f"{check_url} is not reachable; start the web server or unset BUNNYLAND_WEB_NO_SERVER"
        )

    if not local_host:
        raise RuntimeError(f"{check_url} is not reachable and cannot be started locally")

    repo = Path(__file__).resolve().parents[1]
    serve = repo / "serve.sh"
    if not serve.exists():
        raise RuntimeError(f"cannot start web server because {serve} does not exist")

    port = str(parsed.port or 8080)
    log = open("/tmp/bunnyland-web-playwright-server.log", "a", encoding="utf-8")
    proc = subprocess.Popen(
        [str(serve), port],
        cwd=repo,
        stdout=log,
        stderr=subprocess.STDOUT,
    )

    def cleanup() -> None:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        log.close()

    atexit.register(cleanup)

    deadline = time.monotonic() + 30.0
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            break
        if _url_ok(check_url, timeout=0.5):
            return
        time.sleep(0.1)

    raise RuntimeError(f"timed out waiting for {check_url}; see /tmp/bunnyland-web-playwright-server.log")
