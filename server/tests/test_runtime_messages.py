from ai_query.types import TextPart

from chump_server.runtime.messages import build_user_content, is_file_attachment


def test_local_image_attachment_is_exposed_as_a_file_path() -> None:
    attachment = {
        "type": "image",
        "label": "[Image: proof.png]",
        "filename": "proof.png",
        "mime": "image/png",
        "path": "/tmp/proof.png",
    }

    content = build_user_content("Please inspect [Image: proof.png]", [attachment])

    assert isinstance(content, list)
    assert [part.text for part in content if isinstance(part, TextPart)] == [
        "Please inspect ",
        "[File available at: /tmp/proof.png]",
    ]
    assert is_file_attachment(attachment)


def test_generic_file_attachment_is_exposed_as_a_file_path() -> None:
    attachment = {
        "type": "file",
        "label": "[File: notes.pdf]",
        "filename": "notes.pdf",
        "mime": "application/pdf",
        "path": "/tmp/chump/attachments/notes.pdf",
    }

    content = build_user_content("Use [File: notes.pdf]", [attachment])

    assert isinstance(content, list)
    assert [part.text for part in content if isinstance(part, TextPart)] == [
        "Use ",
        "[File available at: /tmp/chump/attachments/notes.pdf]",
    ]
    assert is_file_attachment(attachment)
