"""Notification management facade for backwards compatibility.

Implementation has been partitioned into `harvester.notification.*`.
"""

from __future__ import annotations

from .notification import (
    BEIJING_TIMEZONE,
    NotificationManager,
    NotificationSecretStore,
    _dpapi_transform,
    detect_webhook_format,
    format_beijing_time,
    format_run_message,
    format_simulation_event_message,
    format_submission_score_message,
    maybe_fix_webhook_format,
    send_email,
    send_wechat,
    send_webhook,
    utc_now_iso,
    valid_email,
    validate_webhook_url,
)

# Backwards compatibility aliases
_utc_now_iso = utc_now_iso
_format_beijing_time = format_beijing_time

__all__ = [
    "NotificationManager",
    "NotificationSecretStore",
    "_dpapi_transform",
    "BEIJING_TIMEZONE",
    "format_beijing_time",
    "format_run_message",
    "format_simulation_event_message",
    "format_submission_score_message",
    "utc_now_iso",
    "detect_webhook_format",
    "maybe_fix_webhook_format",
    "send_email",
    "send_wechat",
    "send_webhook",
    "valid_email",
    "validate_webhook_url",
    "_utc_now_iso",
    "_format_beijing_time",
]
