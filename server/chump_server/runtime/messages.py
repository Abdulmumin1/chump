from __future__ import annotations

from pathlib import Path
from typing import Any

from ai_query.types import ImagePart, Message, TextPart


def build_session_title(message: str) -> str:
    normalized = " ".join(message.strip().split())
    if not normalized:
        return "Untitled session"
    if len(normalized) <= 72:
        return normalized
    return normalized[:69].rstrip() + "..."


def build_user_content(
    message: str,
    attachments: list[dict[str, Any]],
) -> str | list[TextPart | ImagePart]:
    files = [
        attachment for attachment in attachments if is_file_attachment(attachment)
    ]
    if not files:
        return message

    parts: list[TextPart | ImagePart] = []
    remaining = message
    used: set[int] = set()

    while remaining:
        next_match: tuple[int, int, dict[str, Any]] | None = None
        for index, attachment in enumerate(files):
            if index in used:
                continue
            label = str(attachment.get("label") or "")
            if not label:
                continue
            position = remaining.find(label)
            if position == -1:
                continue
            if next_match is None or position < next_match[0]:
                next_match = (position, index, attachment)

        if next_match is None:
            append_text_part(parts, remaining)
            remaining = ""
            break

        position, index, attachment = next_match
        label = str(attachment.get("label") or "")
        append_text_part(parts, remaining[:position])
        parts.append(image_attachment_part(attachment))
        used.add(index)
        remaining = remaining[position + len(label) :]

    for index, attachment in enumerate(files):
        if index not in used:
            parts.append(image_attachment_part(attachment))

    return parts


def build_user_display_content(
    message: str,
    attachments: list[dict[str, Any]],
) -> str:
    display = message.rstrip()
    for attachment in attachments:
        if not is_file_attachment(attachment):
            continue
        label = attachment_label(attachment)
        if label and label not in display:
            display = f"{display} {label}".strip()
    return display


def append_text_part(parts: list[TextPart | ImagePart], text: str) -> None:
    if text:
        parts.append(TextPart(text=text))


def image_attachment_part(attachment: dict[str, Any]) -> TextPart | ImagePart:
    path = attachment.get("path")
    if isinstance(path, str) and path:
        return TextPart(text=f"[File available at: {path}]")
    return ImagePart(
        image=f"data:{attachment['mime']};base64,{attachment['data']}",
        media_type=attachment["mime"],
    )


def summarize_attachments(attachments: list[dict[str, Any]]) -> list[dict[str, str]]:
    summaries: list[dict[str, str]] = []
    for attachment in attachments:
        if not is_file_attachment(attachment):
            continue
        summary = {
            "type": str(attachment.get("type") or "file"),
            "label": attachment_label(attachment),
            "filename": str(attachment.get("filename") or "file"),
            "mime": str(attachment.get("mime") or "application/octet-stream"),
        }
        path = str(attachment.get("path") or "")
        if path:
            summary["attachment_id"] = Path(path).name
        summaries.append(summary)
    return summaries


def attachment_label(attachment: dict[str, Any]) -> str:
    label = str(attachment.get("label") or "").strip()
    if label:
        return label
    filename = str(attachment.get("filename") or "file")
    if attachment.get("type") == "image":
        return f"[Image: {filename}]"
    return f"[File: {filename}]"


def image_attachment_label(attachment: dict[str, Any]) -> str:
    return attachment_label(attachment)


def is_file_attachment(attachment: Any) -> bool:
    if not isinstance(attachment, dict):
        return False
    if attachment.get("type") == "file":
        path = attachment.get("path")
        return isinstance(path, str) and bool(path)
    return is_image_attachment(attachment)


def is_image_attachment(attachment: Any) -> bool:
    if not isinstance(attachment, dict):
        return False
    if attachment.get("type") != "image":
        return False
    mime = attachment.get("mime")
    if not isinstance(mime, str) or not mime.startswith("image/"):
        return False
    path = attachment.get("path")
    data = attachment.get("data")
    return (isinstance(path, str) and bool(path)) or (
        isinstance(data, str) and bool(data)
    )


def message_content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for part in content:
        if isinstance(part, TextPart):
            parts.append(part.text)
        elif isinstance(part, dict) and part.get("type") == "text":
            parts.append(str(part.get("text") or ""))
    return "".join(parts)
