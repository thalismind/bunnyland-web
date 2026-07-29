from pathlib import Path
import os
import sys
from unittest import TestCase
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import playwright_container


class PlaywrightContainerTest(TestCase):
    def test_local_prefers_sudo_nerdctl(self) -> None:
        paths = {"sudo": "/usr/bin/sudo", "nerdctl": "/usr/bin/nerdctl", "docker": "/usr/bin/docker"}
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(playwright_container.shutil, "which", side_effect=paths.get),
            patch.object(playwright_container, "_runtime_works", return_value=True),
        ):
            self.assertEqual(
                playwright_container.container_cli(),
                ["/usr/bin/sudo", "/usr/bin/nerdctl"],
            )

    def test_ci_prefers_docker(self) -> None:
        paths = {"sudo": "/usr/bin/sudo", "nerdctl": "/usr/bin/nerdctl", "docker": "/usr/bin/docker"}
        with (
            patch.dict(os.environ, {"CI": "true"}, clear=True),
            patch.object(playwright_container.shutil, "which", side_effect=paths.get),
            patch.object(playwright_container, "_runtime_works", return_value=True),
        ):
            self.assertEqual(playwright_container.container_cli(), ["/usr/bin/docker"])

    def test_podman_is_supported_as_fallback(self) -> None:
        paths = {"podman": "/usr/bin/podman"}
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(playwright_container.shutil, "which", side_effect=paths.get),
            patch.object(playwright_container, "_runtime_works", return_value=True),
        ):
            self.assertEqual(playwright_container.container_cli(), ["/usr/bin/podman"])

    def test_explicit_runtime_must_work(self) -> None:
        with (
            patch.dict(os.environ, {"BUNNYLAND_CONTAINER_CLI": "podman --remote"}, clear=True),
            patch.object(playwright_container, "_runtime_works", return_value=False),
        ):
            with self.assertRaisesRegex(RuntimeError, "configured container runtime"):
                playwright_container.container_cli()

    def test_missing_runtime_fails(self) -> None:
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(playwright_container.shutil, "which", return_value=None),
        ):
            with self.assertRaisesRegex(RuntimeError, "Docker, nerdctl, or Podman"):
                playwright_container.container_cli()

    def test_grant_container_user_access_uses_fixed_uid_acl(self) -> None:
        fixture = Path("/tmp/auth-users.yml")
        with (
            patch.object(Path, "is_symlink", return_value=False),
            patch.object(Path, "exists", return_value=True),
            patch.object(playwright_container.shutil, "which", return_value="/usr/bin/setfacl"),
            patch.object(playwright_container.subprocess, "run") as run,
        ):
            playwright_container.grant_container_user_access(fixture, "r")

        run.assert_called_once_with(
            ["/usr/bin/setfacl", "-m", "u:10001:r", str(fixture)],
            check=True,
        )

    def test_grant_container_user_access_rejects_symlinks(self) -> None:
        fixture = Path("/tmp/auth-users.yml")
        with patch.object(Path, "is_symlink", return_value=True):
            with self.assertRaisesRegex(RuntimeError, "must not be a symlink"):
                playwright_container.grant_container_user_access(fixture, "r")

    def test_stop_container_stops_by_name_and_reaps_process(self) -> None:
        proc = Mock()
        with patch.object(playwright_container.subprocess, "run") as run:
            playwright_container.stop_container(["podman"], "browser-api-123", proc)

        run.assert_called_once_with(
            ["podman", "stop", "browser-api-123"],
            stdout=playwright_container.subprocess.DEVNULL,
            stderr=playwright_container.subprocess.DEVNULL,
            check=False,
        )
        proc.wait.assert_called_once_with(timeout=10)
