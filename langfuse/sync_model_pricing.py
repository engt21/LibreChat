#!/usr/bin/env python3

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from urllib import error, request


ROOT = Path(__file__).resolve().parents[1]
TOKEN_PRICE_SCALE = 1_000_000

DEFAULT_ALIAS_MODEL_MAP = {
    "gemini-pro-latest": "gemini-pro-latest",
    "gemini-flash-latest": "gemini-flash-latest",
    "gemini-flash-lite-latest": "gemini-flash-lite-latest",
}

FAMILY_MODEL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "modelName": "grok-4.20-beta",
        "provider": "xai",
        "pricingModel": "grok-4.20-beta",
        "matchPattern": r"(?i)^(?:xai/)?grok-4\.20-beta(?:(?:-latest)|(?:-0309))?(?:-(?:reasoning|non-reasoning))?$",
        "probes": [
            "grok-4.20-beta-latest",
            "grok-4.20-beta-latest-reasoning",
            "grok-4.20-beta-latest-non-reasoning",
            "grok-4.20-beta-0309-reasoning",
        ],
    },
    {
        "modelName": "grok-4.20-multi-agent",
        "provider": "xai",
        "pricingModel": "grok-4.20-multi-agent",
        "matchPattern": r"(?i)^(?:xai/)?grok-4\.20-multi-agent(?:-beta(?:-0309)?)?$",
        "probes": [
            "grok-4.20-multi-agent",
            "grok-4.20-multi-agent-beta",
            "grok-4.20-multi-agent-beta-0309",
        ],
    },
    {
        "modelName": "grok-4-1-fast",
        "provider": "xai",
        "pricingModel": "grok-4-1-fast",
        "matchPattern": r"(?i)^(?:xai/)?grok-4-1-fast(?:-(?:reasoning|non-reasoning))?$",
        "probes": ["grok-4-1-fast", "grok-4-1-fast-reasoning", "grok-4-1-fast-non-reasoning"],
    },
    {
        "modelName": "grok-4-fast",
        "provider": "xai",
        "pricingModel": "grok-4-fast",
        "matchPattern": r"(?i)^(?:xai/)?grok-4-fast(?:-(?:reasoning|non-reasoning))?$",
        "probes": ["grok-4-fast", "grok-4-fast-reasoning", "grok-4-fast-non-reasoning"],
    },
    {
        "modelName": "grok-3-mini",
        "provider": "xai",
        "pricingModel": "grok-3-mini",
        "matchPattern": r"(?i)^(?:xai/)?grok-3-mini(?:-[a-z0-9._-]+)?$",
        "probes": ["grok-3-mini", "xai/grok-3-mini"],
    },
    {
        "modelName": "grok-3",
        "provider": "xai",
        "pricingModel": "grok-3",
        "matchPattern": r"(?i)^(?:xai/)?grok-3(?:-[a-z0-9._-]+)?$",
        "probes": ["grok-3", "xai/grok-3"],
    },
    {
        "modelName": "grok-3-fast",
        "provider": "xai",
        "pricingModel": "grok-3-fast",
        "matchPattern": r"(?i)^(?:xai/)?grok-3-fast(?:-[a-z0-9._-]+)?$",
        "probes": ["grok-3-fast", "xai/grok-3-fast"],
    },
    {
        "modelName": "grok-4",
        "provider": "xai",
        "pricingModel": "grok-4",
        "matchPattern": r"(?i)^(?:xai/)?grok-4(?:-(?:reasoning|non-reasoning|latest|0709))?$",
        "probes": ["grok-4", "grok-4-0709", "xai/grok-4"],
    },
    {
        "modelName": "grok-code-fast",
        "provider": "xai",
        "pricingModel": "grok-code-fast",
        "matchPattern": r"(?i)^(?:xai/)?grok-code-fast(?:-1)?(?:-[a-z0-9._-]+)?$",
        "probes": ["grok-code-fast", "grok-code-fast-1", "xai/grok-code-fast-1"],
    },
]

MODEL_LIST_ENV_KEYS: tuple[tuple[str, str], ...] = (
    ("OPENAI_MODELS", "openai"),
    ("GOOGLE_MODELS", "google"),
    ("ANTHROPIC_MODELS", "anthropic"),
    ("AZURE_OPENAI_MODELS", "azure"),
)

PROVIDER_PREFIXES = {
    "openai": ["openai/"],
    "azure": ["openai/", "azure/", "azure-openai/"],
    "anthropic": ["anthropic/"],
    "google": ["google/", "models/"],
    "xai": ["xai/"],
    "ollama": ["openai/"],
}

FAMILY_PRICE_KEYS = {
    "grok-4.20-beta",
    "grok-4.20-multi-agent",
    "grok-4-1-fast",
    "grok-4-fast",
    "grok-code-fast",
    "grok-4",
}

CUSTOM_PROVIDER_ALIASES = {
    "azureopenai": "azure",
    "azure": "azure",
    "openai": "openai",
    "google": "google",
    "anthropic": "anthropic",
    "xai": "xai",
    "ollama": "ollama",
}


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}

    if not path.exists():
        return values

    for line in path.read_text().splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"')

    return values


def load_env_values(path: Path) -> dict[str, str]:
    values = read_env_file(path)
    values.update({key: value for key, value in os.environ.items() if value != ""})
    return values


def get_env_value(env_values: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        value = env_values.get(key)
        if value:
            return value
    return None


def parse_model_list(raw: str | None) -> list[str]:
    if not raw:
        return []

    seen: set[str] = set()
    models: list[str] = []

    for item in re.split(r"[\n,]", raw):
        model = item.strip().strip('"').strip("'")
        if not model or model in seen:
            continue
        seen.add(model)
        models.append(model)

    return models


def parse_alias_model_map(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {
                str(alias).strip(): str(model).strip()
                for alias, model in parsed.items()
                if str(alias).strip() and str(model).strip()
            }
    except json.JSONDecodeError:
        pass

    alias_map: dict[str, str] = {}
    for item in re.split(r"[\n,]", raw):
        if "=" not in item:
            continue
        alias, model = item.split("=", 1)
        alias = alias.strip()
        model = model.strip()
        if alias and model:
            alias_map[alias] = model

    return alias_map


def build_alias_model_map(env_values: dict[str, str]) -> dict[str, str]:
    return {
        **DEFAULT_ALIAS_MODEL_MAP,
        **parse_alias_model_map(env_values.get("LANGFUSE_MODEL_ALIAS_MAP")),
    }


def normalize_for_pricing(model: str | None) -> str:
    normalized = (model or "").strip()
    normalized = re.sub(r"^(?:models|google|anthropic|openai|azure|azure-openai|xai|ollama)/", "", normalized, flags=re.I)
    return normalized


def guess_provider(model: str | None) -> str:
    raw = (model or "").strip().lower()
    if raw.startswith(("azure-openai/", "azure/")):
        return "azure"

    normalized = normalize_for_pricing(model).lower()

    if normalized.startswith("claude"):
        return "anthropic"
    if normalized.startswith(("gemini", "gemma")):
        return "google"
    if normalized.startswith("grok"):
        return "xai"
    if normalized.startswith("gptoss") or normalized.endswith(":latest"):
        return "ollama"
    return "openai"


def resolve_tokenizer_id(provider: str) -> str | None:
    if provider in {"openai", "azure", "xai", "ollama"}:
        return "openai"
    if provider == "anthropic":
        return "claude"
    return None


def http_request_json(
    url: str,
    auth_header: str | None = None,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
) -> Any:
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if auth_header is not None:
        headers["Authorization"] = auth_header
    req = request.Request(url, data=data, method=method, headers=headers)
    with request.urlopen(req, timeout=30) as response:
        body = response.read().decode()
    return json.loads(body) if body else None


def list_langfuse_models(base_url: str, auth_header: str) -> list[dict[str, Any]]:
    page = 1
    models: list[dict[str, Any]] = []
    while True:
        body = http_request_json(
            f"{base_url.rstrip('/')}/api/public/models?limit=100&page={page}",
            auth_header,
        )
        models.extend(body.get("data", []))
        meta = body.get("meta") or {}
        if page >= int(meta.get("totalPages") or page):
            return models
        page += 1


def model_matches_alias(model: dict[str, Any], alias: str) -> bool:
    if model.get("modelName") == alias:
        return True

    pattern = model.get("matchPattern")
    if not pattern:
        return False

    try:
        return re.match(pattern, alias) is not None
    except re.error:
        return False


def aliases_are_covered(existing_models: list[dict[str, Any]], aliases: list[str]) -> bool:
    return all(any(model_matches_alias(model, alias) for model in existing_models) for alias in aliases)


def find_exact_model(existing_models: list[dict[str, Any]], model_name: str) -> dict[str, Any] | None:
    for model in existing_models:
        if model.get("modelName") == model_name:
            return model
    return None


def find_covering_model(existing_models: list[dict[str, Any]], alias: str) -> dict[str, Any] | None:
    for model in existing_models:
        if model_matches_alias(model, alias):
            return model
    return None


def load_tx_pricing() -> dict[str, Any]:
    node_script = """
const Module = require('module');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@librechat/api') {
    return {
      matchModelName: () => undefined,
      findMatchingPattern: () => undefined,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const tx = require(process.argv[1]);
process.stdout.write(JSON.stringify({
  tokenValues: tx.tokenValues,
  cacheTokenValues: tx.cacheTokenValues,
  premiumTokenValues: tx.premiumTokenValues,
}));
"""

    result = subprocess.run(
        ["node", "-e", node_script, str(ROOT / "api/models/tx.js")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def load_custom_endpoint_configs(config_path: Path) -> list[dict[str, Any]]:
    if not config_path.exists():
        return []

    node_script = """
const fs = require('fs');
const YAML = require('yaml');
const doc = YAML.parse(fs.readFileSync(process.argv[1], 'utf8')) || {};
const endpoints = (((doc || {}).endpoints || {}).custom || []).map((endpoint) => ({
  name: endpoint?.name || '',
  baseURL: endpoint?.baseURL || null,
  baseURLs: Array.isArray(endpoint?.baseURLs) ? endpoint.baseURLs : [],
  apiKey: endpoint?.apiKey || null,
  defaultParamsEndpoint: endpoint?.customParams?.defaultParamsEndpoint || null,
  modelsFetch: Boolean(endpoint?.models?.fetch),
  modelDefaults: Array.isArray(endpoint?.models?.default) ? endpoint.models.default : [],
}));
process.stdout.write(JSON.stringify(endpoints));
"""

    result = subprocess.run(
        ["node", "-e", node_script, str(config_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    parsed = json.loads(result.stdout)
    return parsed if isinstance(parsed, list) else []


def normalize_custom_provider(provider: str | None) -> str | None:
    if provider is None:
        return None
    return CUSTOM_PROVIDER_ALIASES.get(provider.replace("-", "").replace("_", "").lower())


def resolve_custom_endpoint_provider(endpoint: dict[str, Any]) -> str:
    explicit_provider = normalize_custom_provider(endpoint.get("defaultParamsEndpoint"))
    if explicit_provider:
        return explicit_provider

    name_provider = normalize_custom_provider(endpoint.get("name"))
    if name_provider:
        return name_provider

    base_url = endpoint.get("baseURL") or ""
    if "x.ai" in base_url:
        return "xai"

    model_defaults = endpoint.get("modelDefaults") or []
    if model_defaults:
        return guess_provider(model_defaults[0])

    return "openai"


def derive_ollama_tags_urls(base_url: str) -> list[str]:
    if not base_url:
        return []

    parsed = urlsplit(base_url)
    path = re.sub(r"/v1/?$", "", parsed.path or "", flags=re.I).rstrip("/")
    tags_path = f"{path}/api/tags" if path else "/api/tags"

    return [urlunsplit((parsed.scheme, parsed.netloc, tags_path, "", ""))]


def discover_ollama_models(endpoint: dict[str, Any]) -> tuple[list[str], str | None]:
    urls = []
    for value in [endpoint.get("baseURL"), *(endpoint.get("baseURLs") or [])]:
        if value:
            urls.extend(derive_ollama_tags_urls(value))

    seen_urls: set[str] = set()
    models: list[str] = []
    last_error: str | None = None

    for url in urls:
        if url in seen_urls:
            continue
        seen_urls.add(url)

        try:
            body = http_request_json(url)
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            continue

        discovered = body.get("models") or []
        for model in discovered:
            model_name = (model.get("model") or model.get("name") or "").strip()
            if model_name and model_name not in models:
                models.append(model_name)

        if models:
            return models, None

    return [], last_error


def find_matching_price_key(model: str, token_values: dict[str, Any]) -> str | None:
    normalized_model = normalize_for_pricing(model)
    model_lower = normalized_model.lower()
    matched_key: str | None = None

    for key in token_values:
        key_lower = key.lower()
        if key_lower not in model_lower:
            continue
        if matched_key is None or len(key) > len(matched_key):
            matched_key = key
        if len(key) == len(normalized_model):
            return key

    return matched_key


def is_exact_or_explicit_family_match(model: str, price_key: str | None) -> bool:
    if price_key is None:
        return False

    normalized_model = normalize_for_pricing(model).lower()
    key_lower = price_key.lower()

    return normalized_model == key_lower or price_key in FAMILY_PRICE_KEYS


def build_match_pattern(alias: str, provider: str) -> str:
    escaped = re.escape(alias)
    prefixes = PROVIDER_PREFIXES.get(provider, [])
    prefix_pattern = ""

    if prefixes:
        escaped_prefixes = "|".join(re.escape(prefix) for prefix in prefixes)
        prefix_pattern = rf"(?:{escaped_prefixes})?"

    if provider == "google":
        return rf"(?i)^{prefix_pattern}{escaped}(?:@[A-Za-z0-9]+)?$"

    return rf"(?i)^{prefix_pattern}{escaped}(?:-[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}})?$"


def build_payload_from_existing(
    alias: str,
    provider: str,
    source_model: dict[str, Any],
    *,
    match_pattern: str | None = None,
) -> dict[str, Any] | None:
    if source_model.get("totalPrice") is None and source_model.get("inputPrice") is None and source_model.get("outputPrice") is None:
        return None

    payload: dict[str, Any] = {
        "modelName": alias,
        "matchPattern": match_pattern or build_match_pattern(alias, provider),
        "unit": source_model.get("unit") or "TOKENS",
    }

    tokenizer_id = source_model.get("tokenizerId") or resolve_tokenizer_id(provider)
    if tokenizer_id is not None:
        payload["tokenizerId"] = tokenizer_id

    if source_model.get("totalPrice") is not None:
        payload["totalPrice"] = source_model.get("totalPrice")
    else:
        payload["inputPrice"] = source_model.get("inputPrice") or 0
        payload["outputPrice"] = source_model.get("outputPrice") or 0

    return payload


def build_payload_from_tx(
    alias: str,
    pricing_model: str,
    provider: str,
    tx_pricing: dict[str, Any],
    *,
    match_pattern: str | None = None,
    force_zero: bool = False,
    allow_fuzzy: bool = False,
) -> dict[str, Any] | None:
    payload: dict[str, Any] = {
        "modelName": alias,
        "matchPattern": match_pattern or build_match_pattern(alias, provider),
        "unit": "TOKENS",
    }

    tokenizer_id = resolve_tokenizer_id(provider)
    if tokenizer_id is not None:
        payload["tokenizerId"] = tokenizer_id

    if force_zero:
        payload["inputPrice"] = 0
        payload["outputPrice"] = 0
        return payload

    token_values = tx_pricing.get("tokenValues") or {}
    price_key = find_matching_price_key(pricing_model, token_values)
    if price_key is None:
        return None

    if not allow_fuzzy and not is_exact_or_explicit_family_match(pricing_model, price_key):
        return None

    price_entry = token_values.get(price_key) or {}
    payload["inputPrice"] = (price_entry.get("prompt") or 0) / TOKEN_PRICE_SCALE
    payload["outputPrice"] = (price_entry.get("completion") or 0) / TOKEN_PRICE_SCALE
    return payload


def build_alias_payload(
    alias: str,
    pricing_model: str,
    provider: str,
    existing_models: list[dict[str, Any]],
    tx_pricing: dict[str, Any],
    *,
    match_pattern: str | None = None,
    force_zero: bool = False,
    allow_fuzzy: bool = False,
) -> dict[str, Any] | None:
    source_model = find_exact_model(existing_models, pricing_model) or find_covering_model(
        existing_models,
        pricing_model,
    )

    if source_model is not None and not force_zero:
        payload = build_payload_from_existing(
            alias,
            provider,
            source_model,
            match_pattern=match_pattern,
        )
        if payload is not None:
            return payload

    return build_payload_from_tx(
        alias,
        pricing_model,
        provider,
        tx_pricing,
        match_pattern=match_pattern,
        force_zero=force_zero,
        allow_fuzzy=allow_fuzzy,
    )


def fetch_litellm_model_info(litellm_url: str) -> list[dict[str, Any]]:
    body = http_request_json(f"{litellm_url.rstrip('/')}/model/info")
    return body.get("data", [])


def detect_pricing(model_info: dict[str, Any]) -> tuple[str, float | None, float | None, float | None] | None:
    input_token = model_info.get("input_cost_per_token")
    output_token = model_info.get("output_cost_per_token")
    input_char = model_info.get("input_cost_per_character")
    output_char = model_info.get("output_cost_per_character")
    total_cost = model_info.get("output_cost_per_image")

    if input_token is not None or output_token is not None:
        return "TOKENS", input_token, output_token, None

    if input_char is not None or output_char is not None:
        return "CHARACTERS", input_char, output_char, None

    if total_cost is not None:
        return "TOKENS", None, None, total_cost

    return None


def build_litellm_payload(item: dict[str, Any]) -> dict[str, Any] | None:
    alias = item.get("model_name")
    if not alias:
        return None

    litellm_model = (item.get("litellm_params") or {}).get("model") or alias
    provider = guess_provider(litellm_model)
    pricing = detect_pricing(item.get("model_info") or {})

    if pricing is None:
        return None

    unit, input_price, output_price, total_price = pricing
    payload: dict[str, Any] = {
        "modelName": alias,
        "matchPattern": build_match_pattern(alias, provider),
        "unit": unit,
    }

    tokenizer_id = resolve_tokenizer_id(provider)
    if tokenizer_id is not None:
        payload["tokenizerId"] = tokenizer_id

    if total_price is not None:
        payload["totalPrice"] = total_price
    else:
        payload["inputPrice"] = input_price or 0
        payload["outputPrice"] = output_price or 0

    return payload


def register_candidate(
    candidates: list[dict[str, Any]],
    seen_names: set[str],
    *,
    payload: dict[str, Any] | None,
    probes: list[str],
    exact_only: bool,
    skipped: list[str],
    skip_reason: str,
) -> None:
    if payload is None:
        skipped.append(skip_reason)
        return

    model_name = payload.get("modelName")
    if not model_name or model_name in seen_names:
        return

    seen_names.add(model_name)
    candidates.append({"payload": payload, "probes": probes, "exact_only": exact_only})


def build_candidates(
    existing_models: list[dict[str, Any]],
    tx_pricing: dict[str, Any],
    env_values: dict[str, str],
    litellm_url: str | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    alias_model_map = build_alias_model_map(env_values)

    candidates: list[dict[str, Any]] = []
    skipped: list[str] = []
    seen_names: set[str] = set()

    for alias, pricing_model in alias_model_map.items():
        if find_exact_model(existing_models, alias) is not None:
            continue

        provider = guess_provider(pricing_model)
        payload = build_alias_payload(
            alias,
            pricing_model,
            provider,
            existing_models,
            tx_pricing,
        )
        register_candidate(
            candidates,
            seen_names,
            payload=payload,
            probes=[alias],
            exact_only=True,
            skipped=skipped,
            skip_reason=f"{alias} (no pricing source)",
        )

    config_path = ROOT / "librechat.yaml"
    try:
        custom_endpoints = load_custom_endpoint_configs(config_path)
    except Exception as exc:  # noqa: BLE001
        custom_endpoints = []
        skipped.append(f"Custom endpoint config parsing skipped ({exc})")

    for endpoint in custom_endpoints:
        provider = resolve_custom_endpoint_provider(endpoint)
        endpoint_models = parse_model_list(",".join(endpoint.get("modelDefaults") or []))

        if provider == "ollama":
            discovered_models, discovery_error = discover_ollama_models(endpoint)
            endpoint_models.extend(model for model in discovered_models if model not in endpoint_models)
            if discovery_error:
                skipped.append(f"Ollama model discovery skipped ({discovery_error})")

        for model_alias in endpoint_models:
            if find_exact_model(existing_models, model_alias) is not None:
                continue

            pricing_model = alias_model_map.get(model_alias, model_alias)
            payload = build_alias_payload(
                model_alias,
                pricing_model,
                provider,
                existing_models,
                tx_pricing,
                force_zero=provider == "ollama",
                allow_fuzzy=True,
            )
            register_candidate(
                candidates,
                seen_names,
                payload=payload,
                probes=[model_alias],
                exact_only=True,
                skipped=skipped,
                skip_reason=f"{model_alias} (no pricing source)",
            )

    for definition in FAMILY_MODEL_DEFINITIONS:
        probes = definition.get("probes") or [definition["modelName"]]
        if find_exact_model(existing_models, definition["modelName"]) is not None or aliases_are_covered(existing_models, probes):
            continue

        payload = build_alias_payload(
            definition["modelName"],
            definition.get("pricingModel") or definition["modelName"],
            definition["provider"],
            existing_models,
            tx_pricing,
            match_pattern=definition.get("matchPattern"),
            force_zero=bool(definition.get("forceZero")),
            allow_fuzzy=True,
        )
        register_candidate(
            candidates,
            seen_names,
            payload=payload,
            probes=probes,
            exact_only=False,
            skipped=skipped,
            skip_reason=f"{definition['modelName']} (no pricing source)",
        )

    for env_key, provider in MODEL_LIST_ENV_KEYS:
        for model_alias in parse_model_list(env_values.get(env_key)):
            if find_exact_model(existing_models, model_alias) is not None:
                continue

            pricing_model = alias_model_map.get(model_alias, model_alias)
            payload = build_alias_payload(
                model_alias,
                pricing_model,
                provider,
                existing_models,
                tx_pricing,
                allow_fuzzy=True,
            )
            register_candidate(
                candidates,
                seen_names,
                payload=payload,
                probes=[model_alias],
                exact_only=True,
                skipped=skipped,
                skip_reason=f"{model_alias} (no pricing source)",
            )

    if litellm_url:
        try:
            litellm_models = fetch_litellm_model_info(litellm_url)
        except Exception as exc:  # noqa: BLE001
            skipped.append(f"LiteLLM sync skipped ({exc})")
        else:
            for item in litellm_models:
                alias = item.get("model_name")
                if not alias:
                    continue
                if find_exact_model(existing_models, alias) is not None:
                    continue
                payload = build_litellm_payload(item)
                register_candidate(
                    candidates,
                    seen_names,
                    payload=payload,
                    probes=[alias],
                    exact_only=True,
                    skipped=skipped,
                    skip_reason=f"{alias} (no supported LiteLLM pricing fields)",
                )

    return candidates, skipped


def normalize_runtime_provider(provider: str | None) -> str | None:
    if not provider:
        return None

    normalized = provider.replace("-", "").replace("_", "").lower()
    mapping = {
        "googlegenai": "google",
        "google": "google",
        "anthropic": "anthropic",
        "openai": "openai",
        "azureopenai": "azure",
        "azure": "azure",
        "xai": "xai",
        "ollama": "ollama",
    }
    return mapping.get(normalized)


def model_pricing_size(model: dict[str, Any]) -> int:
    size = 0

    prices = model.get("prices") or {}
    if isinstance(prices, dict):
        size = max(size, len(prices))

    for tier in model.get("pricingTiers") or []:
        tier_prices = tier.get("prices") or {}
        if isinstance(tier_prices, dict):
            size = max(size, len(tier_prices))

    if model.get("inputPrice") is not None:
        size = max(size, 1)
    if model.get("outputPrice") is not None:
        size = max(size, 2)
    if model.get("totalPrice") is not None:
        size = max(size, 1)

    return size


def model_has_usable_pricing(model: dict[str, Any] | None) -> bool:
    if model is None:
        return False

    if model_pricing_size(model) <= 0:
        return False

    if model.get("totalPrice") not in (None, 0):
        return True
    if model.get("inputPrice") not in (None, 0):
        return True
    if model.get("outputPrice") not in (None, 0):
        return True

    prices = model.get("prices") or {}
    if isinstance(prices, dict):
        for value in prices.values():
            if isinstance(value, dict):
                value = value.get("price")
            if value not in (None, 0):
                return True

    for tier in model.get("pricingTiers") or []:
        tier_prices = tier.get("prices") or {}
        if isinstance(tier_prices, dict) and any(value not in (None, 0) for value in tier_prices.values()):
            return True

    return False


def model_is_zero_priced(model: dict[str, Any] | None) -> bool:
    if model is None or model_pricing_size(model) <= 0:
        return False
    return not model_has_usable_pricing(model)


def select_best_matching_model(existing_models: list[dict[str, Any]], alias: str) -> dict[str, Any] | None:
    matches: list[tuple[int, dict[str, Any]]] = []

    def rank(model: dict[str, Any], exact: bool) -> tuple[Any, ...]:
        return (
            1 if exact else 0,
            1 if model_has_usable_pricing(model) else 0,
            model_pricing_size(model),
            1 if (model.get("unit") or "").upper() == "TOKENS" else 0,
            len(model.get("matchPattern") or ""),
            len(model.get("modelName") or ""),
            model.get("createdAt") or "",
        )

    for model in existing_models:
        exact = model.get("modelName") == alias
        if exact or model_matches_alias(model, alias):
            matches.append((0, model))

    if not matches:
        return None

    return max((model for _, model in matches), key=lambda model: rank(model, model.get("modelName") == alias))


def extract_best_tier_prices(model: dict[str, Any], usage_details: dict[str, int]) -> tuple[dict[str, Decimal], str | None, str | None]:
    tiers = model.get("pricingTiers") or []
    selected_tier: dict[str, Any] | None = None

    def matches_conditions(tier: dict[str, Any]) -> bool:
        conditions = tier.get("conditions") or []
        for condition in conditions:
            usage_key = str(condition.get("usageDetailPattern") or "").strip()
            operator = str(condition.get("operator") or "eq").lower()
            expected = int(condition.get("value") or 0)
            actual = int(usage_details.get(usage_key) or 0)

            if operator == "gt" and not actual > expected:
                return False
            if operator == "gte" and not actual >= expected:
                return False
            if operator == "lt" and not actual < expected:
                return False
            if operator == "lte" and not actual <= expected:
                return False
            if operator == "eq" and not actual == expected:
                return False
        return True

    if tiers:
        matching_tiers = [tier for tier in tiers if matches_conditions(tier)]
        if matching_tiers:
            selected_tier = max(matching_tiers, key=lambda tier: int(tier.get("priority") or 0))

    prices: dict[str, Decimal] = {}
    source = (selected_tier or {}).get("prices") or model.get("prices") or {}
    if isinstance(source, dict):
        for key, value in source.items():
            if isinstance(value, dict):
                value = value.get("price")
            if value is None:
                continue
            try:
                prices[key] = Decimal(str(value))
            except (InvalidOperation, TypeError, ValueError):
                continue

    if model.get("inputPrice") is not None and "input" not in prices:
        prices["input"] = Decimal(str(model.get("inputPrice")))
    if model.get("outputPrice") is not None and "output" not in prices:
        prices["output"] = Decimal(str(model.get("outputPrice")))
    if model.get("totalPrice") is not None and "total" not in prices:
        prices["total"] = Decimal(str(model.get("totalPrice")))

    return prices, (selected_tier or {}).get("id"), (selected_tier or {}).get("name")


def load_langfuse_runtime_env() -> dict[str, str]:
    runtime_env = read_env_file(ROOT / "langfuse/.env")
    runtime_env.update({key: value for key, value in os.environ.items() if value != ""})
    return runtime_env


def clickhouse_request_json_rows(clickhouse_url: str, user: str, password: str, query: str) -> list[dict[str, Any]]:
    req = request.Request(
        f"{clickhouse_url.rstrip('/')}/?database=default&default_format=JSONEachRow",
        data=query.encode(),
        method="POST",
        headers={
            "Content-Type": "text/plain; charset=utf-8",
            "X-ClickHouse-User": user,
            "X-ClickHouse-Key": password,
        },
    )
    with request.urlopen(req, timeout=60) as response:
        body = response.read().decode().strip()

    if not body:
        return []

    return [json.loads(line) for line in body.splitlines() if line.strip()]


def clickhouse_execute(clickhouse_url: str, user: str, password: str, query: str) -> None:
    req = request.Request(
        f"{clickhouse_url.rstrip('/')}/?database=default&mutations_sync=1",
        data=query.encode(),
        method="POST",
        headers={
            "Content-Type": "text/plain; charset=utf-8",
            "X-ClickHouse-User": user,
            "X-ClickHouse-Key": password,
        },
    )
    with request.urlopen(req, timeout=60):
        return None


def list_observations_for_backfill(clickhouse_url: str, user: str, password: str, limit: int = 500) -> list[dict[str, Any]]:
    query = f"""
SELECT
  id,
  provided_model_name AS model,
  input,
  output,
  usage_details,
  total_cost,
  if(mapContains(usage_details, 'input'), usage_details['input'], toUInt64(0)) AS prompt_tokens,
  if(mapContains(usage_details, 'output'), usage_details['output'], toUInt64(0)) AS completion_tokens,
  if(mapContains(usage_details, 'total'), usage_details['total'], toUInt64(0)) AS total_tokens,
  metadata['ls_provider'] AS provider
FROM observations
WHERE type = 'GENERATION'
  AND provided_model_name IS NOT NULL
  AND provided_model_name != ''
  AND (
    internal_model_id IS NULL
    OR total_cost IS NULL
    OR length(mapKeys(cost_details)) = 0
    OR (total_tokens = 0 AND (input IS NOT NULL OR output IS NOT NULL))
  )
ORDER BY start_time ASC
LIMIT {int(limit)}
FORMAT JSONEachRow
""".strip()
    return clickhouse_request_json_rows(clickhouse_url, user, password, query)


def safe_json_loads(value: Any) -> Any:
    if value in (None, ""):
        return None
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str):
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def estimate_usage_with_node(observations: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    if not observations:
        return {}

    node_script = """
const fs = require('fs');
const { Tokenizer } = require('@librechat/api');
const observations = JSON.parse(fs.readFileSync(0, 'utf8'));

function encodingForModel(model) {
  return /claude/i.test(model || '') ? 'claude' : 'o200k_base';
}

function collectStrings(value, acc = []) {
  if (value == null) return acc;
  if (typeof value === 'string') {
    if (value) acc.push(value);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, acc);
    return acc;
  }
  if (typeof value === 'object') {
    const preferredKeys = ['text', 'content', 'arguments', 'name', 'query', 'title'];
    const seen = new Set();
    for (const key of preferredKeys) {
      if (key in value) {
        seen.add(key);
        collectStrings(value[key], acc);
      }
    }
    for (const [key, nested] of Object.entries(value)) {
      if (seen.has(key) || key === 'role' || key === 'type' || key === 'id' || key === 'index') continue;
      collectStrings(nested, acc);
    }
  }
  return acc;
}

const result = {};
for (const observation of observations) {
  const encoding = encodingForModel(observation.model);
  const promptText = collectStrings(observation.input).join('\\n');
  const completionText = collectStrings(observation.output).join('\\n');
  result[observation.id] = {
    input: promptText ? Tokenizer.getTokenCount(promptText, encoding) : 0,
    output: completionText ? Tokenizer.getTokenCount(completionText, encoding) : 0,
  };
}
process.stdout.write(JSON.stringify(result));
"""

    result = subprocess.run(
        ["node", "-e", node_script],
        cwd=ROOT,
        input=json.dumps(observations),
        capture_output=True,
        text=True,
        check=True,
    )
    parsed = json.loads(result.stdout)
    return parsed if isinstance(parsed, dict) else {}


def decimal_from_float(value: float | Decimal) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def quantize_cost(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.000000000001"), rounding=ROUND_HALF_UP)


def decimal_literal(value: Decimal) -> str:
    return format(quantize_cost(value), "f")


def quote_clickhouse_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def build_decimal_map_expr(values: dict[str, Decimal]) -> str:
    parts: list[str] = []
    for key, value in values.items():
        parts.append(quote_clickhouse_string(key))
        parts.append(f"toDecimal64({quote_clickhouse_string(decimal_literal(value))}, 12)")
    return f"map({', '.join(parts)})"


def resolve_tx_price_key(
    observation_model: str,
    matched_model: dict[str, Any] | None,
    alias_model_map: dict[str, str],
    tx_pricing: dict[str, Any],
) -> str | None:
    token_values = tx_pricing.get("tokenValues") or {}
    candidates = [
        alias_model_map.get(observation_model),
        matched_model.get("modelName") if matched_model else None,
        observation_model,
    ]
    for candidate in candidates:
        if not candidate:
            continue
        price_key = find_matching_price_key(candidate, token_values)
        if price_key is not None:
            return price_key
    return None


def compute_cost_details(
    observation_model: str,
    usage_details: dict[str, int],
    matched_model: dict[str, Any] | None,
    tx_pricing: dict[str, Any],
    alias_model_map: dict[str, str],
) -> dict[str, Decimal] | None:
    if matched_model is not None and model_is_zero_priced(matched_model):
        return {
            "input": Decimal("0"),
            "output": Decimal("0"),
            "total": Decimal("0"),
        }

    input_tokens = int(usage_details.get("input") or 0) + int(usage_details.get("input_audio") or 0)
    cache_read_tokens = int(usage_details.get("input_cache_read") or 0)
    cache_write_tokens = int(
        (usage_details.get("input_cache_creation") or 0)
        + (usage_details.get("cache_creation_input_tokens") or 0)
        + (usage_details.get("input_cache_creation_5m") or 0)
        + (usage_details.get("input_cache_creation_1h") or 0)
    )
    output_tokens = int(usage_details.get("output") or 0)
    output_tokens += int(usage_details.get("output_audio") or 0)
    output_tokens += int(usage_details.get("output_reasoning") or 0)
    output_tokens += int(usage_details.get("output_reasoning_tokens") or 0)

    tier_prices, _, _ = extract_best_tier_prices(matched_model or {}, usage_details)
    price_key = resolve_tx_price_key(observation_model, matched_model, alias_model_map, tx_pricing)
    token_values = tx_pricing.get("tokenValues") or {}
    cache_values = tx_pricing.get("cacheTokenValues") or {}
    premium_values = tx_pricing.get("premiumTokenValues") or {}

    prompt_rate: Decimal | None = None
    completion_rate: Decimal | None = None
    cache_read_rate: Decimal | None = None
    cache_write_rate: Decimal | None = None

    if price_key is not None:
        token_entry = token_values.get(price_key) or {}
        premium_entry = premium_values.get(price_key) or {}
        if premium_entry and input_tokens > int(premium_entry.get("threshold") or 0):
            prompt_rate = decimal_from_float((premium_entry.get("prompt") or 0) / TOKEN_PRICE_SCALE)
            completion_rate = decimal_from_float((premium_entry.get("completion") or 0) / TOKEN_PRICE_SCALE)
        else:
            prompt_rate = decimal_from_float((token_entry.get("prompt") or 0) / TOKEN_PRICE_SCALE)
            completion_rate = decimal_from_float((token_entry.get("completion") or 0) / TOKEN_PRICE_SCALE)

        cache_entry = cache_values.get(price_key) or {}
        if cache_entry.get("read") is not None:
            cache_read_rate = decimal_from_float((cache_entry.get("read") or 0) / TOKEN_PRICE_SCALE)
        if cache_entry.get("write") is not None:
            cache_write_rate = decimal_from_float((cache_entry.get("write") or 0) / TOKEN_PRICE_SCALE)

    if prompt_rate is None:
        prompt_rate = tier_prices.get("input") or tier_prices.get("input_tokens")
    if completion_rate is None:
        completion_rate = tier_prices.get("output") or tier_prices.get("output_tokens")
    if cache_read_rate is None:
        cache_read_rate = tier_prices.get("input_cache_read") or tier_prices.get("cache_read_input_tokens")
    if cache_write_rate is None:
        cache_write_rate = (
            tier_prices.get("input_cache_creation")
            or tier_prices.get("cache_creation_input_tokens")
            or tier_prices.get("input_cache_creation_5m")
            or tier_prices.get("input_cache_creation_1h")
        )

    if prompt_rate is None and completion_rate is None and not tier_prices.get("total"):
        return None

    input_cost = Decimal("0")
    output_cost = Decimal("0")

    if prompt_rate is not None:
        input_cost += decimal_from_float(input_tokens) * prompt_rate
    if cache_read_rate is not None:
        input_cost += decimal_from_float(cache_read_tokens) * cache_read_rate
    if cache_write_rate is not None:
        input_cost += decimal_from_float(cache_write_tokens) * cache_write_rate

    if completion_rate is not None:
        output_cost += decimal_from_float(output_tokens) * completion_rate

    if matched_model and matched_model.get("totalPrice") is not None:
        total_rate = Decimal(str(matched_model.get("totalPrice") or 0))
        total_tokens = int(usage_details.get("total") or (input_tokens + cache_read_tokens + cache_write_tokens + output_tokens))
        total_cost = decimal_from_float(total_tokens) * total_rate
        return {
            "input": quantize_cost(input_cost),
            "output": quantize_cost(output_cost),
            "total": quantize_cost(total_cost),
        }

    total_cost = input_cost + output_cost
    return {
        "input": quantize_cost(input_cost),
        "output": quantize_cost(output_cost),
        "total": quantize_cost(total_cost),
    }


def backfill_observations(
    observations: list[dict[str, Any]],
    existing_models: list[dict[str, Any]],
    tx_pricing: dict[str, Any],
    env_values: dict[str, str],
    clickhouse_url: str,
    clickhouse_user: str,
    clickhouse_password: str,
) -> dict[str, int]:
    alias_model_map = build_alias_model_map(env_values)
    estimated_usage = estimate_usage_with_node(
        [
            {
                "id": observation["id"],
                "model": observation.get("model") or "",
                "input": safe_json_loads(observation.get("input")),
                "output": safe_json_loads(observation.get("output")),
            }
            for observation in observations
            if int(observation.get("total_tokens") or 0) <= 0
        ],
    )

    updated = 0
    usage_estimates_applied = 0

    for observation in observations:
        model_name = str(observation.get("model") or "").strip()
        if not model_name:
            continue

        matched_model = select_best_matching_model(existing_models, model_name)
        if matched_model is None:
            continue

        usage_details = dict(observation.get("usage_details") or {})
        if int(usage_details.get("total") or 0) <= 0:
            estimated = estimated_usage.get(observation["id"]) or {}
            estimated_input = int(estimated.get("input") or 0)
            estimated_output = int(estimated.get("output") or 0)
            estimated_total = estimated_input + estimated_output
            if estimated_total > 0:
                usage_details = {
                    "input": estimated_input,
                    "output": estimated_output,
                    "total": estimated_total,
                }
                usage_estimates_applied += 1

        if int(usage_details.get("total") or 0) <= 0 and not model_is_zero_priced(matched_model):
            continue

        cost_details = compute_cost_details(model_name, usage_details, matched_model, tx_pricing, alias_model_map)
        if cost_details is None:
            continue

        _, tier_id, tier_name = extract_best_tier_prices(matched_model, usage_details)
        prompt_tokens = int(usage_details.get("input") or 0)
        completion_tokens = int(
            (usage_details.get("output") or 0)
            + (usage_details.get("output_audio") or 0)
            + (usage_details.get("output_reasoning") or 0)
            + (usage_details.get("output_reasoning_tokens") or 0)
        )
        total_tokens = int(usage_details.get("total") or prompt_tokens + completion_tokens)

        statements = [
            f"internal_model_id = {quote_clickhouse_string(str(matched_model.get('id') or ''))}",
            f"usage_pricing_tier_id = {quote_clickhouse_string(str(tier_id or ''))}",
            f"usage_pricing_tier_name = {quote_clickhouse_string(str(tier_name or 'Standard'))}",
            f"cost_details = {build_decimal_map_expr(cost_details)}",
            f"total_cost = toDecimal64({quote_clickhouse_string(decimal_literal(cost_details['total']))}, 12)",
            f"updated_at = now64(3)",
        ]

        current_total_tokens = int(observation.get("total_tokens") or 0)
        if current_total_tokens <= 0 and total_tokens > 0:
            statements.extend(
                [
                    f"usage_details = map('input', toUInt64({prompt_tokens}), 'output', toUInt64({completion_tokens}), 'total', toUInt64({total_tokens}))",
                ],
            )

        update_query = (
            "ALTER TABLE observations UPDATE "
            + ", ".join(statements)
            + f" WHERE id = {quote_clickhouse_string(observation['id'])}"
        )
        clickhouse_execute(clickhouse_url, clickhouse_user, clickhouse_password, update_query)
        updated += 1

    return {
        "updated": updated,
        "usage_estimates_applied": usage_estimates_applied,
    }


def ensure_observation_model_coverage(
    observations: list[dict[str, Any]],
    existing_models: list[dict[str, Any]],
    tx_pricing: dict[str, Any],
    env_values: dict[str, str],
    auth_header: str,
    langfuse_url: str,
) -> tuple[list[str], list[str]]:
    alias_model_map = build_alias_model_map(env_values)
    created: list[str] = []
    skipped: list[str] = []

    seen_aliases: set[str] = set()
    for observation in observations:
        alias = str(observation.get("model") or "").strip()
        if not alias or alias in seen_aliases:
            continue
        seen_aliases.add(alias)

        best_match = select_best_matching_model(existing_models, alias)
        if model_has_usable_pricing(best_match) or model_is_zero_priced(best_match):
            continue

        provider = normalize_runtime_provider(observation.get("provider")) or guess_provider(alias_model_map.get(alias, alias))
        payload = build_alias_payload(
            alias,
            alias_model_map.get(alias, alias),
            provider,
            existing_models,
            tx_pricing,
            force_zero=provider == "ollama",
            allow_fuzzy=True,
        )
        if payload is None:
            skipped.append(f"{alias} (observation backfill had no pricing source)")
            continue

        http_request_json(
            f"{langfuse_url.rstrip('/')}/api/public/models",
            auth_header,
            method="POST",
            payload=payload,
        )
        created.append(alias)
        existing_models.append({
            "id": payload.get("id") or alias,
            "modelName": payload.get("modelName"),
            "matchPattern": payload.get("matchPattern"),
            "inputPrice": payload.get("inputPrice"),
            "outputPrice": payload.get("outputPrice"),
            "totalPrice": payload.get("totalPrice"),
            "unit": payload.get("unit"),
            "pricingTiers": [],
        })

    if created:
        refreshed = list_langfuse_models(langfuse_url, auth_header)
        existing_models.clear()
        existing_models.extend(refreshed)

    return created, skipped


def sync_model_pricing(
    env_file: Path,
    langfuse_url: str,
    litellm_url: str | None = None,
) -> dict[str, list[str] | int | dict[str, int]]:
    env_values = load_env_values(env_file)
    public_key = get_env_value(env_values, "LANGFUSE_PUBLIC_KEY", "LANGFUSE_INIT_PROJECT_PUBLIC_KEY")
    secret_key = get_env_value(env_values, "LANGFUSE_SECRET_KEY", "LANGFUSE_INIT_PROJECT_SECRET_KEY")

    if not public_key or not secret_key:
        raise ValueError("Missing LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY credentials")

    auth_header = "Basic " + base64.b64encode(f"{public_key}:{secret_key}".encode()).decode()
    existing_models = list_langfuse_models(langfuse_url, auth_header)
    tx_pricing = load_tx_pricing()
    candidates, skipped = build_candidates(existing_models, tx_pricing, env_values, litellm_url)

    created: list[str] = []

    for candidate in candidates:
        payload = candidate["payload"]
        probes = candidate["probes"]
        exact_only = bool(candidate["exact_only"])

        if find_exact_model(existing_models, payload["modelName"]) is not None:
            continue

        if not exact_only and aliases_are_covered(existing_models, probes):
            continue

        http_request_json(
            f"{langfuse_url.rstrip('/')}/api/public/models",
            auth_header,
            method="POST",
            payload=payload,
        )
        created.append(payload["modelName"])
        existing_models.append(
            {
                "id": payload.get("id") or payload.get("modelName"),
                "modelName": payload.get("modelName"),
                "matchPattern": payload.get("matchPattern"),
                "inputPrice": payload.get("inputPrice"),
                "outputPrice": payload.get("outputPrice"),
                "totalPrice": payload.get("totalPrice"),
                "unit": payload.get("unit"),
                "pricingTiers": [],
            },
        )

    if created:
        existing_models = list_langfuse_models(langfuse_url, auth_header)

    runtime_env = load_langfuse_runtime_env()
    clickhouse_url = runtime_env.get("CLICKHOUSE_URL")
    clickhouse_user = runtime_env.get("CLICKHOUSE_USER")
    clickhouse_password = runtime_env.get("CLICKHOUSE_PASSWORD")

    observation_aliases_created: list[str] = []
    backfill_result = {"updated": 0, "usage_estimates_applied": 0}

    if clickhouse_url and clickhouse_user and clickhouse_password:
        observations = list_observations_for_backfill(clickhouse_url, clickhouse_user, clickhouse_password)
        observation_aliases_created, observation_skipped = ensure_observation_model_coverage(
            observations,
            existing_models,
            tx_pricing,
            env_values,
            auth_header,
            langfuse_url,
        )
        skipped.extend(observation_skipped)
        if observations:
            backfill_result = backfill_observations(
                observations,
                existing_models,
                tx_pricing,
                env_values,
                clickhouse_url,
                clickhouse_user,
                clickhouse_password,
            )

    return {
        "created": created,
        "observation_aliases_created": observation_aliases_created,
        "skipped": skipped,
        "considered": len(candidates),
        "backfilled": backfill_result,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    parser.add_argument("--langfuse-url")
    parser.add_argument("--litellm-url")
    parser.add_argument("--interval-seconds", type=int, default=0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    env_values = load_env_values(args.env_file)
    langfuse_url = args.langfuse_url or get_env_value(env_values, "LANGFUSE_BASE_URL") or "http://127.0.0.1:3000"
    litellm_url = args.litellm_url or get_env_value(env_values, "LITELLM_URL")

    while True:
        had_error = False
        try:
            result = sync_model_pricing(args.env_file, langfuse_url, litellm_url)
            print(json.dumps(result, indent=2), flush=True)
        except error.HTTPError as exc:
            detail = exc.read().decode()
            print(f"Langfuse pricing sync failed: {detail}", file=sys.stderr, flush=True)
            if args.interval_seconds <= 0:
                return 1
            had_error = True
        except (subprocess.CalledProcessError, ValueError) as exc:
            print(f"Langfuse pricing sync failed: {exc}", file=sys.stderr, flush=True)
            if args.interval_seconds <= 0:
                return 1
            had_error = True
        except Exception as exc:  # noqa: BLE001
            print(f"Langfuse pricing sync failed: {exc}", file=sys.stderr, flush=True)
            if args.interval_seconds <= 0:
                return 1
            had_error = True

        if args.interval_seconds <= 0:
            return 0

        time.sleep(min(args.interval_seconds, 15) if had_error else args.interval_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
