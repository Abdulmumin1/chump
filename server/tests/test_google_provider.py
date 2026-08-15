from types import SimpleNamespace

import pytest

from ai_query import ImagePart, LanguageModel, TextPart, ToolOutput
from ai_query.providers.tool_output import transform_messages_for_model
from ai_query.types import Message, ToolResult, ToolResultPart

from chump_server.providers.google import ChumpGoogleProvider
from chump_server.runtime.model import (
    ChumpCloudProvider,
    model_input_modalities,
    resolve_model,
)


def test_google_reasoning_budget_requests_thought_text():
    provider = ChumpGoogleProvider(api_key="test-key")

    options = provider.apply_reasoning(None, {"budget": 8192}, model="gemini-3.5-flash")

    assert options == {
        "google": {
            "thinking_config": {
                "thinking_budget": 8192,
                "include_thoughts": True,
            }
        }
    }


def test_chump_cloud_uses_openai_compatible_gateway_endpoint():
    provider = ChumpCloudProvider(
        api_key="chump-cloud",
        base_url="https://cloud.chmp.dev/v1",
    )

    assert provider.name == "chump_cloud"
    assert provider.base_url == "https://cloud.chmp.dev/v1"


def test_chump_cloud_resolves_supported_models_to_the_gateway(monkeypatch):
    monkeypatch.setattr("chump_server.runtime.model.auth_file_path", lambda: None)
    monkeypatch.setattr("chump_server.runtime.model.load_auth_config", lambda: {})

    deepseek = resolve_model(
        SimpleNamespace(provider="chump_cloud", model="deepseek-v4-flash")
    )

    assert isinstance(deepseek.provider, ChumpCloudProvider)
    assert deepseek.provider.base_url == "https://cloud.chmp.dev/v1"
    assert deepseek.input_modalities == ("text",)


@pytest.mark.asyncio
async def test_chump_cloud_uses_gateway_session_affinity_without_openai_cache_field():
    captured: dict[str, object] = {}

    class CaptureTransport:
        async def post(self, url, json, headers=None):
            captured.update({"url": url, "body": json, "headers": headers})
            return {
                "choices": [
                    {"message": {"content": "ok"}, "finish_reason": "stop"}
                ]
            }

    provider = ChumpCloudProvider(
        api_key="chump-cloud",
        base_url="https://cloud.chmp.dev/v1",
    )
    provider._transport = CaptureTransport()
    provider.cache_key = "running-session"

    await provider.generate(
        model="deepseek-v4-flash",
        messages=[Message(role="user", content="hello")],
    )
    deepseek_options = provider._build_request_options(
        {},
        {},
        model="deepseek-v4-flash",
    )

    assert "prompt_cache_key" not in captured["body"]
    assert "prompt_cache_key" not in deepseek_options
    assert captured["headers"]["x-session-affinity"] == "running-session"


def test_model_input_modalities_are_declared_centrally():
    assert model_input_modalities(
        "workers_ai", "@cf/moonshotai/kimi-k2.6"
    ) == ("text", "image")
    assert model_input_modalities("workers_ai", "@cf/zai-org/glm-5.7") == (
        "text",
    )
    assert model_input_modalities("chump_cloud", "deepseek-v4-flash") == (
        "text",
    )


@pytest.mark.asyncio
async def test_chump_cloud_projects_image_tool_results_for_gateway_chat():
    provider = ChumpCloudProvider(
        api_key="chump-cloud",
        base_url="https://cloud.chmp.dev/v1",
    )
    model = LanguageModel(
        provider=provider,
        model_id="gemini-3.7-flash",
        input_modalities=("text", "image"),
    )
    message = Message(
        role="tool",
        content=[
            ToolResultPart(
                tool_result=ToolResult(
                    tool_call_id="call_1",
                    tool_name="view_image",
                    result=ToolOutput(
                        content=[
                            TextPart(text="Image loaded."),
                            ImagePart(image=b"png-bytes", media_type="image/png"),
                        ]
                    ),
                )
            )
        ],
    )

    projected = transform_messages_for_model([message], model)
    messages = await provider._convert_messages(projected)

    assert messages[0]["role"] == "tool"
    assert messages[0]["content"] == "Image loaded."
    assert messages[1]["role"] == "user"
    assert messages[1]["content"][1]["type"] == "image_url"
    assert messages[1]["content"][1]["image_url"]["url"].startswith(
        "data:image/png;base64,"
    )


@pytest.mark.asyncio
async def test_chump_cloud_projects_history_for_supported_text_model(monkeypatch):
    monkeypatch.setattr("chump_server.runtime.model.auth_file_path", lambda: None)
    monkeypatch.setattr("chump_server.runtime.model.load_auth_config", lambda: {})

    output = ToolOutput(
        content=[
            TextPart(text="Image loaded from screenshot.png."),
            ImagePart(image=b"png-bytes", media_type="image/png"),
        ]
    )
    message = Message(
        role="tool",
        content=[
            ToolResultPart(
                tool_result=ToolResult(
                    tool_call_id="call_1",
                    tool_name="view_image",
                    result=output,
                )
            )
        ],
    )

    history = [message]
    deepseek = resolve_model(
        SimpleNamespace(provider="chump_cloud", model="deepseek-v4-flash")
    )

    deepseek_history = transform_messages_for_model(history, deepseek)
    deepseek_result = deepseek_history[0].content[0].tool_result.result
    deepseek_request = await deepseek.provider._convert_messages(deepseek_history)

    assert isinstance(deepseek_result, str)
    assert "Image loaded from screenshot.png." in deepseek_result
    assert "tool image omitted" in deepseek_result
    assert deepseek_request[0]["content"] == deepseek_result
    assert message.content[0].tool_result.result is output
