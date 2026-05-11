import os

import pytest

from chump_server.config import normalize_model_name


def test_normalize_model_name_accepts_provider_model_pair():
    assert normalize_model_name("deepseek", "deepseek-v4-flash") == "deepseek-v4-flash"


def test_normalize_model_name_rejects_cross_provider_model_pair():
    with pytest.raises(ValueError, match="invalid model"):
        normalize_model_name("deepseek", "@cf/moonshotai/kimi-k2.6")


def test_normalize_model_name_uses_provider_default_when_not_strict():
    assert (
        normalize_model_name("deepseek", "@cf/moonshotai/kimi-k2.6", strict=False)
        == "deepseek-v4-pro"
    )
