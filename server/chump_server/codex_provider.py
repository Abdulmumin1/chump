from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, AsyncIterator
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ai_query.model import LanguageModel
from ai_query.providers.openai import OpenAIProvider
from ai_query.types import Message, ProviderOptions, ReasoningEvent, StreamChunk, ToolCall, ToolSet, Usage

CODEX_API_BASE_URL = "https://chatgpt.com/backend-api/codex"
OPENAI_AUTH_TOKEN_URL = "https://auth.openai.com/oauth/token"
CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"


class CodexProvider(OpenAIProvider):
    name = "codex"

    def __init__(
        self,
        *,
        auth_path: Path,
        auth_config: dict[str, Any],
    ) -> None:
        self.auth_path = auth_path
        self.auth_config = auth_config
        credentials = codex_credentials(auth_config)
        self.access_token = string_value(credentials.get("access"))
        self.refresh_token = string_value(credentials.get("refresh"))
        self.expires = number_value(credentials.get("expires")) or 0
        self.account_id = string_value(credentials.get("account_id")) or string_value(credentials.get("accountId"))
        if not self.refresh_token:
            raise ValueError("codex provider requires `chump connect` with ChatGPT Pro/Plus OAuth")
        super().__init__(
            api_key=self.access_token or "chump-codex-oauth",
            base_url=CODEX_API_BASE_URL,
        )

    def _get_headers(self) -> dict[str, str]:
        self._refresh_if_needed()
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "originator": "chump",
            "User-Agent": "chump",
        }
        if self.account_id:
            headers["ChatGPT-Account-Id"] = self.account_id
        return headers

    def _should_use_responses_api(
        self,
        *,
        tools: Any,
        request_options: dict[str, Any],
    ) -> bool:
        return bool(tools)

    def _refresh_if_needed(self) -> None:
        if self.access_token and self.expires > int(time.time() * 1000) + 30_000:
            return
        tokens = refresh_access_token(self.refresh_token)
        self.access_token = tokens["access_token"]
        self.refresh_token = tokens["refresh_token"]
        self.expires = int(time.time() * 1000) + int(tokens.get("expires_in", 3600)) * 1000
        credentials = codex_credentials(self.auth_config)
        credentials.update(
            {
                "type": "oauth",
                "access": self.access_token,
                "refresh": self.refresh_token,
                "expires": self.expires,
            }
        )
        if account_id := extract_account_id(tokens):
            self.account_id = account_id
            credentials["account_id"] = account_id
        write_auth_config(self.auth_path, self.auth_config)

    async def stream(
        self,
        *,
        model: str,
        messages: list[Message],
        tools: ToolSet | None = None,
        provider_options: ProviderOptions | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[StreamChunk]:
        options = self._build_request_options(kwargs, self.get_provider_options(provider_options))
        response_options = self._build_responses_request_options(options)
        response_options = with_reasoning_summary(response_options)
        body = {
            "model": model,
            "input": sanitize_response_input_items(await self._convert_messages_for_responses(messages)),
            "tools": self._convert_tools_for_responses(tools or {}),
            **response_options,
        }
        body["stream"] = True
        body["store"] = False

        buffer = b""
        usage = None
        finish_reason = None
        output_items: dict[str, dict[str, Any]] = {}
        saw_reasoning_delta = False

        async for chunk_bytes in self.transport.stream(
            f"{self.base_url}/responses",
            body,
            headers=self._get_headers(),
        ):
            buffer += chunk_bytes
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                event = self._parse_response_sse_json(line)
                if event is None:
                    continue

                event_type = str(event.get("type") or "")
                if event_type == "response.output_text.delta":
                    delta = event.get("delta")
                    if delta:
                        yield StreamChunk(text=str(delta))
                    continue

                if event_type in {
                    "response.reasoning_summary_text.delta",
                    "response.reasoning_text.delta",
                }:
                    delta = event.get("delta")
                    text = str(delta or "")
                    if is_meaningful_reasoning_fragment(text):
                        saw_reasoning_delta = True
                        yield StreamChunk(
                            reasoning_events=[
                                ReasoningEvent(
                                    kind="summary" if "summary" in event_type else "delta",
                                    provider=self.name,
                                    text=text,
                                    data={"event": event_type},
                                )
                            ]
                        )
                    continue

                if event_type == "response.output_item.done":
                    item = event.get("item")
                    if isinstance(item, dict) and item.get("id"):
                        output_items[str(item["id"])] = item
                        if not saw_reasoning_delta:
                            summaries = extract_reasoning_summary_texts(item)
                            if summaries:
                                saw_reasoning_delta = True
                                yield reasoning_summary_chunk("\n\n".join(summaries), event_type)
                    continue

                if event_type == "response.completed":
                    response = event.get("response")
                    if isinstance(response, dict):
                        finish_reason = response.get("status")
                        usage = parse_responses_usage(response.get("usage"))
                        for item in response.get("output") or []:
                            if isinstance(item, dict) and item.get("id"):
                                output_items[str(item["id"])] = item
                                if not saw_reasoning_delta:
                                    summaries = extract_reasoning_summary_texts(item)
                                    if summaries:
                                        saw_reasoning_delta = True
                                        yield reasoning_summary_chunk("\n\n".join(summaries), event_type)
                    continue

                if event_type == "response.failed":
                    response = event.get("response")
                    error = response.get("error") if isinstance(response, dict) else None
                    raise Exception(json.dumps(error or event))

        yield StreamChunk(
            is_final=True,
            usage=usage,
            finish_reason=finish_reason,
            tool_calls=extract_tool_calls(list(output_items.values())) or None,
        )

    def _parse_response_sse_json(self, line: bytes | str) -> dict[str, Any] | None:
        data = self._parse_sse_line(line)
        if data is None or data == "[DONE]":
            return None
        try:
            parsed = json.loads(data)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None


def codex_model(
    model_id: str,
    *,
    auth_path: Path,
    auth_config: dict[str, Any],
) -> LanguageModel:
    return LanguageModel(
        provider=CodexProvider(auth_path=auth_path, auth_config=auth_config),
        model_id=model_id,
    )


def parse_responses_usage(value: Any) -> Usage | None:
    if not isinstance(value, dict):
        return None
    input_details = value.get("input_tokens_details")
    if not isinstance(input_details, dict):
        input_details = {}
    return Usage(
        input_tokens=value.get("input_tokens", 0),
        output_tokens=value.get("output_tokens", 0),
        cached_tokens=input_details.get("cached_tokens", 0),
        total_tokens=value.get("total_tokens", 0),
    )


def with_reasoning_summary(options: dict[str, Any]) -> dict[str, Any]:
    updated = dict(options)
    reasoning = updated.get("reasoning")
    if isinstance(reasoning, dict):
        reasoning = dict(reasoning)
        reasoning.setdefault("summary", "auto")
        updated["reasoning"] = reasoning

    include = updated.get("include")
    if include is None:
        include_items: list[Any] = []
    elif isinstance(include, list):
        include_items = list(include)
    else:
        include_items = [include]
    if "reasoning.encrypted_content" not in include_items:
        include_items.append("reasoning.encrypted_content")
    updated["include"] = include_items
    return updated


def reasoning_summary_chunk(text: str, source_event: str) -> StreamChunk:
    cleaned = clean_reasoning_summary(text)
    return StreamChunk(
        reasoning_events=[
            ReasoningEvent(
                kind="summary",
                provider="codex",
                text=cleaned,
                data={"event": source_event, "field": "reasoning.summary"},
            )
        ]
    )


def extract_reasoning_summary_texts(item: dict[str, Any]) -> list[str]:
    if item.get("type") != "reasoning":
        return []
    texts = []
    for part in item.get("summary") or []:
        if isinstance(part, dict):
            text = clean_reasoning_summary(str(part.get("text") or ""))
            if text:
                texts.append(text)
    return texts


def clean_reasoning_summary(value: str) -> str:
    text = " ".join(value.split()).strip()
    if len(text) < 3:
        return ""
    if not any(character.isalnum() for character in text):
        return ""
    return text


def is_meaningful_reasoning_fragment(value: str) -> bool:
    text = value.strip()
    if not text:
        return False
    if len(text) < 3 and not any(character.isalnum() for character in text):
        return False
    return True


def extract_tool_calls(output_items: list[dict[str, Any]]) -> list[ToolCall]:
    tool_calls = []
    reasoning_items = [item for item in output_items if item.get("type") == "reasoning"]
    for item in output_items:
        if item.get("type") != "function_call":
            continue
        try:
            arguments = json.loads(item.get("arguments") or "{}")
        except json.JSONDecodeError:
            arguments = {}
        call_id = item.get("call_id") or item.get("id") or f"call_{len(tool_calls)}"
        response_output = [*reasoning_items, item] if not tool_calls else [item]
        tool_calls.append(
            ToolCall(
                id=call_id,
                name=item.get("name", ""),
                arguments=arguments,
                metadata={"openai_response_output": response_output},
            )
        )
    return tool_calls


def sanitize_response_input_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [sanitize_response_input_item(item) for item in items]


def sanitize_response_input_item(item: dict[str, Any]) -> dict[str, Any]:
    item_type = item.get("type")
    if item_type == "function_call":
        return {
            "type": "function_call",
            "call_id": item.get("call_id") or item.get("id"),
            "name": item.get("name", ""),
            "arguments": item.get("arguments") or "{}",
        }
    if item_type == "reasoning":
        summary = item.get("summary")
        encrypted_content = item.get("encrypted_content")
        sanitized = {"type": "reasoning"}
        if summary is not None:
            sanitized["summary"] = summary
        if encrypted_content:
            sanitized["encrypted_content"] = encrypted_content
        return sanitized
    return item


def codex_credentials(auth_config: dict[str, Any]) -> dict[str, Any]:
    credentials = auth_config.setdefault("credentials", {})
    if not isinstance(credentials, dict):
        raise ValueError("invalid auth config: credentials must be an object")
    provider_credentials = credentials.setdefault("codex", {})
    if not isinstance(provider_credentials, dict):
        raise ValueError("invalid auth config: credentials.codex must be an object")
    return provider_credentials


def refresh_access_token(refresh_token: str) -> dict[str, Any]:
    body = urlencode(
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CLIENT_ID,
        }
    ).encode()
    request = Request(
        OPENAI_AUTH_TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_account_id(tokens: dict[str, Any]) -> str | None:
    for key in ("id_token", "access_token"):
        token = string_value(tokens.get(key))
        if not token:
            continue
        claims = parse_jwt_claims(token)
        if not claims:
            continue
        account_id = (
            string_value(claims.get("chatgpt_account_id"))
            or string_value((claims.get("https://api.openai.com/auth") or {}).get("chatgpt_account_id"))
        )
        if account_id:
            return account_id
        organizations = claims.get("organizations")
        if isinstance(organizations, list) and organizations:
            first = organizations[0]
            if isinstance(first, dict):
                return string_value(first.get("id"))
    return None


def parse_jwt_claims(token: str) -> dict[str, Any] | None:
    import base64

    parts = token.split(".")
    if len(parts) != 3:
        return None
    payload = parts[1]
    payload += "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload.encode()).decode()
        claims = json.loads(decoded)
    except (ValueError, json.JSONDecodeError):
        return None
    return claims if isinstance(claims, dict) else None


def write_auth_config(auth_path: Path, auth_config: dict[str, Any]) -> None:
    auth_path.parent.mkdir(parents=True, exist_ok=True)
    auth_path.write_text(f"{json.dumps(auth_config, indent=2)}\n")
    auth_path.chmod(0o600)


def string_value(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def number_value(value: Any) -> int | None:
    return value if isinstance(value, int) else None
