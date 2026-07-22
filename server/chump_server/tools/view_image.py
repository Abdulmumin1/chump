from __future__ import annotations

from ai_query import Field, ImagePart, TextPart, ToolOutput, tool

from ..safety import PathResolver, SafetyError


MAX_IMAGE_BYTES = 20 * 1024 * 1024
SUPPORTED_IMAGE_TYPES = {
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"GIF87a": "image/gif",
    b"GIF89a": "image/gif",
}


def detect_image_type(data: bytes) -> str | None:
    for signature, media_type in SUPPORTED_IMAGE_TYPES.items():
        if data.startswith(signature):
            return media_type
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def bind_view_image(guard: PathResolver, wrap_tool):
    @tool(
        description=(
            "Inspect a PNG, JPEG, GIF, or WebP image. "
            "Returns the image visually to the model."
        )
    )
    async def view_image_impl(
        path: str = Field(
            description="Image path; relative paths resolve from workspace root"
        ),
    ) -> ToolOutput:
        async def runner() -> ToolOutput:
            image_path = guard.resolve_path(path)
            if not image_path.exists():
                raise SafetyError(f"file does not exist: {path}")
            if not image_path.is_file():
                raise SafetyError(f"not a file: {path}")

            size = image_path.stat().st_size
            if size > MAX_IMAGE_BYTES:
                raise SafetyError(
                    f"image is too large: {size} bytes (maximum {MAX_IMAGE_BYTES})"
                )

            data = image_path.read_bytes()
            media_type = detect_image_type(data)
            if media_type is None:
                raise SafetyError(
                    "unsupported image type; expected PNG, JPEG, GIF, or WebP"
                )

            return ToolOutput(
                content=[
                    TextPart(text=f"Image loaded from {path}."),
                    ImagePart(image=data, media_type=media_type),
                ]
            )

        return await wrap_tool("view_image", {"path": path}, runner)

    return view_image_impl
