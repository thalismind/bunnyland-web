from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "docker" / "41-render-admin-policy.sh"
DOCKERFILE = ROOT / "Dockerfile"
NGINX_TEMPLATE = ROOT / "nginx" / "default.conf.template"


class NginxResolverTests(unittest.TestCase):
    def test_docker_resolver_is_the_portable_default(self) -> None:
        dockerfile = DOCKERFILE.read_text()
        template = NGINX_TEMPLATE.read_text()

        self.assertIn("BUNNYLAND_DNS_RESOLVER=127.0.0.11", dockerfile)
        self.assertIn("resolver ${BUNNYLAND_DNS_RESOLVER} ipv6=off valid=10s;", template)
        self.assertNotIn("resolver 127.0.0.11", template)


class NginxAdminPolicyTests(unittest.TestCase):
    def _render(self, enabled: str) -> tuple[subprocess.CompletedProcess[str], str]:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "policy.conf"
            env = {
                **os.environ,
                "BUNNYLAND_EDGE_ADMIN_ENABLED": enabled,
                "BUNNYLAND_EDGE_ADMIN_POLICY_PATH": str(output),
            }
            result = subprocess.run(
                ["sh", str(SCRIPT)], capture_output=True, check=False, text=True, env=env
            )
            return result, output.read_text() if output.exists() else ""

    def test_admin_routes_are_blocked_by_default(self) -> None:
        result, policy = self._render("false")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(policy, "return 403;\n")

    def test_admin_routes_can_be_enabled_explicitly(self) -> None:
        result, policy = self._render("true")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(policy, "")

    def test_invalid_policy_fails_closed(self) -> None:
        result, policy = self._render("yes")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(policy, "")


if __name__ == "__main__":
    unittest.main()
