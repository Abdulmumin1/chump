from __future__ import annotations

from pathlib import Path

from ai_query import Field, ImagePart, TextPart, ToolOutput, tool

from ..safety import PathResolver, SafetyError
from ..patch_tool import read_text_snapshot
from ._utils import _workspace_key, _fingerprint


MAX_IMAGE_BYTES = 20 * 1024 * 1024
SUPPORTED_IMAGE_TYPES = {
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"GIF87a": "image/gif",
    b"GIF89a": "image/gif",
}

DESCRIPTION = (
    "Read a file. Returns text content, or the image itself for "
    "PNG, JPEG, GIF, and WebP files."
)


def detect_image_type(data: bytes) -> str | None:
    for signature, media_type in SUPPORTED_IMAGE_TYPES.items():
        if data.startswith(signature):
            return media_type
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return None


@tool(description=DESCRIPTION)
async def read_file(
    path: str = Field(
        description="File path; relative paths resolve from workspace root"
    ),
    offset: int = Field(
        description="Zero-based line offset to start reading from", default=0
    ),
    limit: int = Field(description="Maximum number of lines to read", default=200),
) -> str | ToolOutput:
    raise NotImplementedError("read_file must be bound via bind_read_file")


def bind_read_file(
    guard: PathResolver,
    wrap_tool,
    remember_file_read,
    resolve_read_context,
):
    @tool(description=DESCRIPTION)
    async def read_file_impl(
        path: str = Field(
            description="File path; relative paths resolve from workspace root"
        ),
        offset: int = Field(
            description="Zero-based line offset to start reading from", default=0
        ),
        limit: int = Field(description="Maximum number of lines to read", default=200),
    ) -> str | ToolOutput:
        async def runner() -> str | ToolOutput:
            file_path = guard.resolve_path(path)
            if not file_path.exists():
                raise SafetyError(f"file does not exist: {path}")
            if not file_path.is_file():
                raise SafetyError(f"not a file: {path}")

            with file_path.open("rb") as handle:
                head = handle.read(12)
            media_type = detect_image_type(head)
            if media_type is not None:
                size = file_path.stat().st_size
                if size > MAX_IMAGE_BYTES:
                    raise SafetyError(
                        f"image is too large: {size} bytes (maximum {MAX_IMAGE_BYTES})"
                    )
                return ToolOutput(
                    content=[
                        TextPart(text=f"Image loaded from {path}."),
                        ImagePart(image=file_path.read_bytes(), media_type=media_type),
                    ]
                )

            snapshot = read_text_snapshot(file_path)
            await remember_file_read(path, file_path)
            lines = snapshot.text.splitlines()
            start_index = max(offset, 0)
            line_count = max(limit, 1)
            end_index = start_index + line_count
            numbered = [
                f"{index + 1}: {line}"
                for index, line in enumerate(
                    lines[start_index:end_index], start=start_index
                )
            ]
            content = "\n".join(numbered)
            extra_text, metadata = await resolve_read_context(file_path)
            if extra_text:
                content = f"{content}\n\n{extra_text}" if content else extra_text
            return content, metadata

        return await wrap_tool(
            "read_file",
            {"path": path, "offset": offset, "limit": limit},
            runner,
        )

    return read_file_impl
