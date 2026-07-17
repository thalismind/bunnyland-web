from pathlib import Path
import sys
from unittest import TestCase
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import playwright_server


class PlaywrightServerTest(TestCase):
    def test_url_check_identifies_the_playwright_runner(self) -> None:
        response = MagicMock()
        response.status = 200
        response.__enter__.return_value = response
        with patch.object(playwright_server.urllib.request, "urlopen", return_value=response) as urlopen:
            self.assertTrue(
                playwright_server._url_ok("https://sandbox.bunnyland.dev/index.html", timeout=5.0)
            )

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("User-agent"), "Bunnyland-Playwright/1.0")
        self.assertEqual(urlopen.call_args.kwargs, {"timeout": 5.0})

    def test_remote_prerequisite_allows_normal_network_latency(self) -> None:
        with patch.object(playwright_server, "_url_ok", return_value=True) as url_ok:
            playwright_server.ensure_web_server("https://sandbox.bunnyland.dev")

        url_ok.assert_called_once_with(
            "https://sandbox.bunnyland.dev/index.html", timeout=5.0
        )

    def test_local_prerequisite_keeps_fast_retry_timeout(self) -> None:
        with patch.object(playwright_server, "_url_ok", return_value=True) as url_ok:
            playwright_server.ensure_web_server("http://127.0.0.1:8091")

        url_ok.assert_called_once_with("http://127.0.0.1:8091/index.html", timeout=0.5)
