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

    def test_api_key_is_required(self):
        with patch.object(companion, 'BASE_URL', 'http://127.0.0.1:8080'), patch.object(companion, 'API_KEY', ''):
            with self.assertRaises(RuntimeError):
                companion.validate_config()

    def test_only_documented_read_routes_are_exposed(self):
        self.assertEqual(set(companion.ROUTES), {'/api/status', '/api/queue', '/api/library'})
        self.assertTrue(all(path.startswith('/api/v1/') for path in companion.ROUTES.values()))
        self.assertFalse(any(word in path for path in companion.ROUTES.values() for word in ('download', 'stream', 'search')))

    def test_response_limit_is_bounded(self):
        self.assertEqual(companion.MAX_RESPONSE_BYTES, 2 * 1024 * 1024)

if __name__ == '__main__':
    unittest.main()