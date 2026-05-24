import asyncio
import sys
from pathlib import Path

from ai_query.types import Message

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chump_server.providers.codex import CODEX_API_BASE_URL, CodexProvider


def test_codex_generate_uses_responses_api_without_tools(tmp_path):
    provider = CodexProvider(
        auth_path=tmp_path / "auth.json",
        auth_config={
            "credentials": {
                "codex": {
                    "access": "access-token",
                    "refresh": "refresh-token",
                    "expires": 9_999_999_999_999,
                }
            }
        },
    )

    calls: list[tuple[str, dict]] = []

    class DummyTransport:
        async def post(self, url, json, headers=None):
            calls.append((url, json))
            return {
                "id": "resp_123",
                "model": "gpt-5.5",
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "summary text"}],
                    }
                ],
                "usage": {
                    "input_tokens": 10,
                    "output_tokens": 5,
                    "total_tokens": 15,
                    "input_tokens_details": {"cached_tokens": 0},
                },
            }

    provider._transport = DummyTransport()

    result = asyncio.run(
        provider.generate(
            model="gpt-5.5",
            messages=[Message(role="user", content="summarize this transcript")],
        )
    )

    assert result.text == "summary text"
    assert calls == [
        (
            f"{CODEX_API_BASE_URL}/responses",
            {
                "model": "gpt-5.5",
                "input": [{"role": "user", "content": "summarize this transcript"}],
                "include": ["reasoning.encrypted_content"],
                "store": False,
            },
        )
    ]
