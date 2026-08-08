from types import SimpleNamespace

import pytest

from ai_query import ImagePart, TextPart, ToolOutput
from ai_query.providers.tool_output import transform_messages_for_model
from ai_query.types import Message, ToolResult, ToolResultPart

from chump_server.providers.google import ChumpGoogleProvider
from chump_server.runtime.model import (
    ChumpCloudGoogleProvider,
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


def test_chump_cloud_google_uses_native_worker_endpoint():
    provider = ChumpCloudGoogleProvider(
        api_key="chump-cloud",
        base_url="https://cloud.chmp.dev/v1/google/v1beta",
    )

    assert provider.name == "chump_cloud"
    assert provider.base_url == "https://cloud.chmp.dev/v1/google/v1beta"


def test_chump_cloud_resolves_gemini_to_native_provider(monkeypatch):
    monkeypatch.setattr("chump_server.runtime.model.auth_file_path", lambda: None)
    monkeypatch.setattr("chump_server.runtime.model.load_auth_config", lambda: {})

    model = resolve_model(
        SimpleNamespace(provider="chump_cloud", model="gemini-3.6-flash")
    )

    assert isinstance(model.provider, ChumpCloudGoogleProvider)
    assert model.provider.base_url == "https://cloud.chmp.dev/v1/google/v1beta"
    assert model.input_modalities == ("text", "image", "file")


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
async def test_chump_cloud_google_maps_image_tool_results_without_loss():
    provider = ChumpCloudGoogleProvider(
        api_key="chump-cloud",
        base_url="https://cloud.chmp.dev/v1/google/v1beta",
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

    _, messages = await provider._convert_messages(
        [message], model="gemini-3.6-flash"
    )

    response = messages[0]["parts"][0]["functionResponse"]
    assert response["response"] == {"result": "Image loaded."}
    assert response["parts"][0]["inlineData"]["mimeType"] == "image/png"


@pytest.mark.asyncio
async def test_chump_cloud_projects_history_for_each_selected_model(monkeypatch):
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
    gemini = resolve_model(
        SimpleNamespace(provider="chump_cloud", model="gemini-3.6-flash")
    )

    deepseek_history = transform_messages_for_model(history, deepseek)
    deepseek_result = deepseek_history[0].content[0].tool_result.result
    deepseek_request = await deepseek.provider._convert_messages(deepseek_history)
    gemini_history = transform_messages_for_model(history, gemini)

    assert isinstance(deepseek_result, str)
    assert "Image loaded from screenshot.png." in deepseek_result
    assert "tool image omitted" in deepseek_result
    assert deepseek_request[0]["content"] == deepseek_result
    assert gemini_history == history
    assert gemini_history[0].content[0].tool_result.result is output
    assert message.content[0].tool_result.result is output
