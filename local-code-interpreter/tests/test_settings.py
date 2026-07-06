from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.settings import get_settings


class SettingsTest(unittest.TestCase):
    def test_defaults_to_one_hour_ttl_and_minimum_cleanup_interval(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            settings = get_settings()
        self.assertEqual(settings.session_ttl_hours, 1)
        self.assertEqual(settings.cleanup_interval_seconds, 60)

    def test_clamps_unsafe_cleanup_values(self) -> None:
        with patch.dict(
            os.environ,
            {
                'LOCAL_CODE_SESSION_TTL_HOURS': '0',
                'LOCAL_CODE_CLEANUP_INTERVAL_SECONDS': '1',
            },
            clear=True,
        ):
            settings = get_settings()
        self.assertEqual(settings.session_ttl_hours, 1)
        self.assertEqual(settings.cleanup_interval_seconds, 10)


if __name__ == '__main__':
    unittest.main()
