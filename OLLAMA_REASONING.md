# Ollama Reasoning Controls in LibreChat

LibreChat now treats the dedicated `Ollama` custom endpoint as its own reasoning profile instead of reusing the full OpenAI reasoning control surface.

## What changed

For the dedicated `Ollama` endpoint:

- `reasoning_effort` only exposes values that Ollama currently accepts:
  - `auto`
  - `none`
  - `low`
  - `medium`
  - `high`
- `reasoning_summary` is no longer shown or sent for Ollama chats
- `verbosity` is still available and is passed through to Ollama
- existing legacy presets are normalized:
  - `minimal -> low`
  - `xhigh -> high`

## Why LibreChat hides reasoning when effort is `none`

Some Ollama-served reasoning models, including `gpt-oss` variants, can still emit reasoning text even when the request includes:

```json
{
  "reasoning": { "effort": "none" }
}
```

That means `none` is not a reliable provider-side guarantee that no reasoning tokens will be returned.

LibreChat now compensates for that behavior in two places for Ollama chats:

- server-side: reasoning delta events are suppressed when `reasoning_effort` is `none`
- client-side: any leftover Ollama reasoning blocks are hidden when the same setting is active

Practical result: in LibreChat, setting Ollama reasoning to `none` now behaves like an actual "off" mode even if the underlying Ollama API still returns reasoning fields.

## Recommended settings

- Use `none` when you want the cleanest chat UI and fastest visible response path
- Use `low` for light reasoning with less overhead
- Use `medium` or `high` only when the model genuinely needs extra chain-of-thought budget
- Keep `verbosity` low if you want shorter final answers

## Config notes

Use the dedicated `Ollama` custom endpoint with:

```yaml
customParams:
  defaultParamsEndpoint: 'ollama'
```

That tells LibreChat to use the Ollama-specific parameter schema and UI.

## Related docs

- [./README.md](./README.md)
- [./LOCAL_SERVICE_RUNBOOK.local.md](./LOCAL_SERVICE_RUNBOOK.local.md)
- [./OLLAMA_WEB_SEARCH.md](./OLLAMA_WEB_SEARCH.md)
