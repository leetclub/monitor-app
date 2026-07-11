"""Send Slack direct messages (conversations.open + chat.postMessage)."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional
from urllib.parse import quote

import requests

logger = logging.getLogger(__name__)

_TOKEN = (os.environ.get("SLACK_BOT_TOKEN") or os.environ.get("SLACK_USER_TOKEN") or "").strip()
_TIMEOUT = int(os.environ.get("SLACK_DM_TIMEOUT_SEC", "25"))


def slack_dm_configured() -> bool:
    return bool(_TOKEN)


def send_slack_dm_to_user_id(user_id: str, message: str) -> Dict[str, Any]:
    uid = str(user_id or "").strip()
    text = str(message or "").strip()
    if not uid:
        return {"ok": False, "error": "Slack user id required"}
    if not text:
        return {"ok": False, "error": "Message required"}
    if not _TOKEN:
        return {"ok": False, "error": "SLACK_BOT_TOKEN not configured"}

    headers = {"Authorization": f"Bearer {_TOKEN}", "Content-Type": "application/json"}
    try:
        open_res = requests.post(
            "https://slack.com/api/conversations.open",
            headers=headers,
            json={"users": uid, "return_im": True},
            timeout=_TIMEOUT,
        )
        open_data = open_res.json() if open_res.ok else {}
        if not open_data.get("ok"):
            err = str(open_data.get("error") or "conversations.open failed")
            return {"ok": False, "error": err}
        channel = open_data.get("channel") if isinstance(open_data.get("channel"), dict) else {}
        channel_id = str(channel.get("id") or "").strip()
        if not channel_id:
            return {"ok": False, "error": "Slack returned no DM channel"}

        post_res = requests.post(
            "https://slack.com/api/chat.postMessage",
            headers=headers,
            json={"channel": channel_id, "text": text, "mrkdwn": True},
            timeout=_TIMEOUT,
        )
        post_data = post_res.json() if post_res.ok else {}
        if not post_data.get("ok"):
            err = str(post_data.get("error") or "chat.postMessage failed")
            return {"ok": False, "error": err, "channelId": channel_id}
        return {
            "ok": True,
            "channelId": channel_id,
            "ts": post_data.get("ts"),
            "slackUserId": uid,
        }
    except Exception as ex:
        logger.exception("send_slack_dm_to_user_id")
        return {"ok": False, "error": str(ex)}


def send_slack_dm_to_email(email: str, message: str) -> Dict[str, Any]:
    em = str(email or "").strip().lower()
    if not em:
        return {"ok": False, "error": "Operator email required"}
    try:
        from slack_user_map_lib import slack_user_id_for_email

        uid = slack_user_id_for_email(em)
    except Exception:
        logger.exception("slack_user_id_for_email")
        uid = None
    if not uid:
        return {"ok": False, "error": f"No Slack user mapped for {em}"}
    out = send_slack_dm_to_user_id(uid, message)
    out["operatorEmail"] = em
    return out


def mailto_go_check_url(
    email: str,
    *,
    machine_name: str,
    machine_id: str,
    error_type: str,
    message: str,
) -> str:
    em = str(email or "").strip()
    if not em:
        return ""
    subject = f"GO CHECK — {machine_name or machine_id}"
    body = "\n".join(
        [
            "URGENT ACTION REQUIRED",
            "",
            f"Machine: {machine_name} (#{machine_id})",
            f"Error type: {error_type}",
            "",
            message,
            "",
            "Due: 24 hours",
            "— Leet Alert GO CHECK",
        ]
    )
    return f"mailto:{em}?subject={quote(subject)}&body={quote(body)}"
