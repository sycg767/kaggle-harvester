import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harvester.wechat_bot import format_beijing_time


class WechatBotTimeTests(unittest.TestCase):
    def test_utc_time_is_converted_to_beijing_time(self):
        self.assertEqual(
            format_beijing_time("2026-08-20T03:10:00Z"),
            "11:10",
        )

    def test_explicit_beijing_time_is_not_converted_twice(self):
        self.assertEqual(
            format_beijing_time("2026-08-20T11:10:00+08:00"),
            "11:10",
        )

    def test_time_without_timezone_keeps_upstream_clock_value(self):
        self.assertEqual(
            format_beijing_time("2026-08-20T11:10:00"),
            "11:10",
        )


if __name__ == "__main__":
    unittest.main()
