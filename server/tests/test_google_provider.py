from chump_server.providers.google import ChumpGoogleProvider


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
