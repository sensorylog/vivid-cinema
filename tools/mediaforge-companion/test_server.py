import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name('server.py')
SPEC = importlib.util.spec_from_file_location('vivid_mediaforge_companion', MODULE_PATH)
companion = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(companion)

class CompanionConfigTests(unittest.TestCase):
    def test_upstream_must_be_loopback_http(self):
        with patch.object(companion, 'BASE_URL', 'http://example.com:8080'), patch.object(companion, 'API_KEY', 'test'):
            with self.assertRaises(RuntimeError):
                companion.validate_config()

    def test_https_upstream_is_rejected(self):
        with patch.object(companion, 'BASE_URL', 'https://127.0.0.1:8080'), patch.object(companion, 'API_KEY', 'test'):
            with self.assertRaises(RuntimeError):
                companion.validate_config()

    def test_upstream_credentials_and_query_are_rejected(self):
        for url in ('http://user:pass@127.0.0.1:8080', 'http://127.0.0.1:8080?apikey=secret', 'http://127.0.0.1:8080/#fragment'):
            with self.subTest(url=url), patch.object(companion, 'BASE_URL', url), patch.object(companion, 'API_KEY', 'test'):
                with self.assertRaises(RuntimeError):
                    companion.validate_config()

    def test_api_key_is_required(self):
        with patch.object(companion, 'BASE_URL', 'http://127.0.0.1:8080'), patch.object(companion, 'API_KEY', ''):
            with self.assertRaises(RuntimeError):
                companion.validate_config()

    def test_only_documented_read_routes_are_exposed(self):
        self.assertEqual(set(companion.ROUTES), {'/api/status', '/api/queue', '/api/library'})
        self.assertEqual(set(companion.ROUTES.values()), {'/api/v1/status', '/api/v1/queue', '/api/v1/library'})
        self.assertFalse(any(word in path for path in companion.ROUTES.values() for word in ('download', 'stream', 'search')))

    def test_redirects_are_never_followed(self):
        redirect_handler = companion.NoRedirectHandler()
        self.assertIsNone(redirect_handler.redirect_request(None, None, 302, 'Found', {}, 'http://example.org/steal-key'))

    def test_response_limit_is_bounded(self):
        self.assertEqual(companion.MAX_RESPONSE_BYTES, 2 * 1024 * 1024)

if __name__ == '__main__':
    unittest.main(verbosity=2)