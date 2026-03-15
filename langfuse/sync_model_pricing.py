#!/usr/bin/env python3

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib import error, request


ROOT = Path(__file__).resolve().parents[1]


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"')
    return values


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
    req = request.Request(
        url,
        data=data,
        method=method,
        headers=headers,
    )
    with request.urlopen(req, timeout=30) as response:
        body = response.read().decode()
    return json.loads(body) if body else None


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


def should_use_openai_tokenizer(alias: str, litellm_model: str) -> bool:
    if litellm_model.startswith("openai/"):
        return True
    openai_prefixes = ("gpt-", "o1", "o3", "o4", "davinci", "babbage")
    return alias.startswith(openai_prefixes)


def build_match_pattern(alias: str) -> str:
    escaped = re.escape(alias)
    return rf"(?i)^({escaped})(?:-[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}})?$"


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


def sync_model_pricing(env_file: Path, langfuse_url: str, litellm_url: str) -> dict[str, list[str]]:
    env_values = read_env_file(env_file)
    public_key = env_values["LANGFUSE_PUBLIC_KEY"]
    secret_key = env_values["LANGFUSE_SECRET_KEY"]
    auth_header = "Basic " + base64.b64encode(f"{public_key}:{secret_key}".encode()).decode()

    existing_models = list_langfuse_models(langfuse_url, auth_header)
    litellm_models = fetch_litellm_model_info(litellm_url)

    created: list[str] = []
    skipped: list[str] = []

    for item in litellm_models:
        alias = item.get("model_name")
        litellm_model = (item.get("litellm_params") or {}).get("model") or ""
        model_info = item.get("model_info") or {}

        if not alias:
            continue

        pricing = detect_pricing(model_info)
        if pricing is None:
            skipped.append(f"{alias} (no supported pricing fields)")
            continue

        if any(model_matches_alias(model, alias) for model in existing_models):
            skipped.append(f"{alias} (already covered)")
            continue

        unit, input_price, output_price, total_price = pricing
        payload: dict[str, Any] = {
            "modelName": alias,
            "matchPattern": build_match_pattern(alias),
            "unit": unit,
        }

        if should_use_openai_tokenizer(alias, litellm_model):
            payload["tokenizerId"] = "openai"

        if total_price is not None:
            payload["totalPrice"] = total_price
        else:
            payload["inputPrice"] = input_price or 0
            payload["outputPrice"] = output_price or 0

        http_request_json(
            f"{langfuse_url.rstrip('/')}/api/public/models",
            auth_header,
            method="POST",
            payload=payload,
        )
        created.append(alias)

    return {"created": created, "skipped": skipped}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    parser.add_argument("--langfuse-url", default="http://127.0.0.1:3000")
    parser.add_argument("--litellm-url", default="http://127.0.0.1:4000")
    parser.add_argument("--interval-seconds", type=int, default=0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    while True:
        had_error = False
        try:
            result = sync_model_pricing(args.env_file, args.langfuse_url, args.litellm_url)
            print(json.dumps(result, indent=2), flush=True)
        except error.HTTPError as exc:
            detail = exc.read().decode()
            print(f"Langfuse pricing sync failed: {detail}", file=sys.stderr, flush=True)
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
