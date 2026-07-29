"""Container-runtime selection shared by live-server Playwright regressions."""

from __future__ import annotations

import os
from pathlib import Path
import shlex
import shutil
import subprocess


def _runtime_works(command: list[str]) -> bool:
    try:
        return subprocess.run(
            [*command, "ps"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        ).returncode == 0
    except OSError:
        return False


def container_cli() -> list[str]:
    """Choose Docker in CI, sudo nerdctl locally, then supported fallbacks."""
    override = os.environ.get("BUNNYLAND_CONTAINER_CLI")
    if override is not None:
        command = shlex.split(override)
        if not command:
            raise RuntimeError("BUNNYLAND_CONTAINER_CLI must not be empty")
        if not _runtime_works(command):
            raise RuntimeError(f"configured container runtime is not available: {override}")
        return command

    sudo = shutil.which("sudo")
    nerdctl = shutil.which("nerdctl")
    docker = shutil.which("docker")
    podman = shutil.which("podman")
    if os.environ.get("CI", "").lower() == "true":
        candidates = ([[docker]] if docker else []) + ([[podman]] if podman else [])
        if nerdctl:
            candidates.append([nerdctl])
            if sudo:
                candidates.append([sudo, nerdctl])
    else:
        candidates = []
        if nerdctl and sudo:
            candidates.append([sudo, nerdctl])
        if nerdctl:
            candidates.append([nerdctl])
        if docker:
            candidates.append([docker])
        if podman:
            candidates.append([podman])

    for command in candidates:
        if _runtime_works(command):
            return command
    raise RuntimeError(
        "container runtime CLI not found; install Docker, nerdctl, or Podman, "
        "or set BUNNYLAND_CONTAINER_CLI"
    )


def grant_container_user_access(
    path: Path,
    permissions: str,
    *,
    uid: int = 10001,
) -> None:
    """Grant the fixed non-root server identity access to a bind-mounted fixture."""
    if path.is_symlink():
        raise RuntimeError(f"container fixture must not be a symlink: {path}")
    if not path.exists():
        raise RuntimeError(f"container fixture does not exist: {path}")
    setfacl = shutil.which("setfacl")
    if setfacl is None:
        raise RuntimeError("setfacl is required for fixed-UID container fixtures")
    subprocess.run(
        [setfacl, "-m", f"u:{uid}:{permissions}", str(path)],
        check=True,
    )


def stop_container(command: list[str], name: str, proc: subprocess.Popen | None) -> None:
    """Stop a named test container and reap its attached runtime process."""
    subprocess.run(
        [*command, "stop", name],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if proc is None:
        return
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
