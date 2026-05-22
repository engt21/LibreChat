<p align="center">
  <a href="https://librechat.ai">
    <img src="client/public/assets/logo.svg" height="256">
  </a>
  <h1 align="center">
    <a href="https://librechat.ai">LibreChat</a>
  </h1>
</p>

<p align="center">
  <a href="https://discord.librechat.ai"> 
    <img
      src="https://img.shields.io/discord/1086345563026489514?label=&logo=discord&style=for-the-badge&logoWidth=20&logoColor=white&labelColor=000000&color=blueviolet">
  </a>
  <a href="https://www.youtube.com/@LibreChat"> 
    <img
      src="https://img.shields.io/badge/YOUTUBE-red.svg?style=for-the-badge&logo=youtube&logoColor=white&labelColor=000000&logoWidth=20">
  </a>
  <a href="https://docs.librechat.ai"> 
    <img
      src="https://img.shields.io/badge/DOCS-blue.svg?style=for-the-badge&logo=read-the-docs&logoColor=white&labelColor=000000&logoWidth=20">
  </a>
  <a aria-label="Sponsors" href="https://github.com/sponsors/danny-avila">
    <img
      src="https://img.shields.io/badge/SPONSORS-brightgreen.svg?style=for-the-badge&logo=github-sponsors&logoColor=white&labelColor=000000&logoWidth=20">
  </a>
</p>

<p align="center">
<a href="https://railway.com/deploy/b5k2mn?referralCode=HI9hWz">
  <img src="https://railway.com/button.svg" alt="Deploy on Railway" height="30">
</a>
<a href="https://zeabur.com/templates/0X2ZY8">
  <img src="https://zeabur.com/button.svg" alt="Deploy on Zeabur" height="30"/>
</a>
<a href="https://template.cloud.sealos.io/deploy?templateName=librechat">
  <img src="https://raw.githubusercontent.com/labring-actions/templates/main/Deploy-on-Sealos.svg" alt="Deploy on Sealos" height="30">
</a>
</p>

<p align="center">
  <a href="https://www.librechat.ai/docs/translation">
    <img 
      src="https://img.shields.io/badge/dynamic/json.svg?style=for-the-badge&color=2096F3&label=locize&query=%24.translatedPercentage&url=https://api.locize.app/badgedata/4cb2598b-ed4d-469c-9b04-2ed531a8cb45&suffix=%+translated" 
      alt="Translation Progress">
  </a>
</p>

# ✨ Features

- 🖥️ **UI & Experience** inspired by ChatGPT with enhanced design and features

- 🤖 **AI Model Selection**:
  - Anthropic (Claude), AWS Bedrock, OpenAI, Azure OpenAI, Google, Vertex AI, OpenAI Responses API (incl. Azure)
  - [Custom Endpoints](https://www.librechat.ai/docs/quick_start/custom_endpoints): Use any OpenAI-compatible API with LibreChat, no proxy required
  - This branch adds xAI/Grok custom-endpoint live discovery and capability-aware settings: [./XAI_CUSTOM_ENDPOINTS.md](./XAI_CUSTOM_ENDPOINTS.md)
  - Compatible with [Local & Remote AI Providers](https://www.librechat.ai/docs/configuration/librechat_yaml/ai_endpoints):
    - Ollama, groq, Cohere, Mistral AI, Apple MLX, koboldcpp, together.ai,
    - OpenRouter, Helicone, Perplexity, ShuttleAI, Deepseek, Qwen, and more

- 🔧 **[Code Interpreter API](https://www.librechat.ai/docs/features/code_interpreter)**:
  - Secure, Sandboxed Execution in Python, Node.js (JS/TS), Go, C/C++, Java, PHP, Rust, and Fortran
  - Seamless File Handling: Upload, process, and download files directly
  - No Privacy Concerns: Fully isolated and secure execution
  - Provider-native chat-bar routing is also supported where available: OpenAI/Azure can use native `code_interpreter`, and Google Gemini can use native `codeExecution`
  - **Native tool doc:** [./OPENAI_GEMINI_NATIVE_TOOLS.md](./OPENAI_GEMINI_NATIVE_TOOLS.md)

- 🔦 **Agents & Tools Integration**:
  - **[LibreChat Agents](https://www.librechat.ai/docs/features/agents)**:
    - No-Code Custom Assistants: Build specialized, AI-driven helpers
    - Agent Marketplace: Discover and deploy community-built agents
    - Collaborative Sharing: Share agents with specific users and groups
    - Flexible & Extensible: Use MCP Servers, tools, file search, code execution, and more
    - Compatible with Custom Endpoints, OpenAI, Azure, Anthropic, AWS Bedrock, Google, Vertex AI, Responses API, and more
    - [Model Context Protocol (MCP) Support](https://modelcontextprotocol.io/clients#librechat) for Tools

- ⏰ **Scheduled Runs & Notifications**:
  - Schedule agent runs and model prompts with cron expressions and timezones
  - Notify users by email, browser push, Twilio SMS, or carrier gateway email-to-text addresses
  - [Local guide →](./SCHEDULED_RUNS.md)

- 🔍 **Web Search**:
  - Search the internet and retrieve relevant information to enhance your AI context
  - Includes native provider web search for supported model-chat flows such as OpenAI/Azure Responses API `web_search` and Google Gemini `googleSearch`
  - Includes native provider web search for supported models such as Google Gemini with Grounding with Google Search
  - Includes xAI-native `web_search` for detected xAI custom endpoints using the Responses-style parameter surface
  - Includes Ollama-hosted `web_search` / `web_fetch` modes for the dedicated `Ollama` custom endpoint
  - Grounded Gemini replies can reuse LibreChat's inline citation markers and `Sources` UI when grounding metadata is returned by the provider
  - Combines search providers, content scrapers, and result rerankers for optimal results
  - **Customizable Jina Reranking**: Configure custom Jina API URLs for reranking services
  - **OpenAI/Gemini native tool doc:** [./OPENAI_GEMINI_NATIVE_TOOLS.md](./OPENAI_GEMINI_NATIVE_TOOLS.md)
  - **Ollama guide:** [./OLLAMA_WEB_SEARCH.md](./OLLAMA_WEB_SEARCH.md)
  - **[Learn More →](https://www.librechat.ai/docs/features/web_search)**

- 🪄 **Generative UI with Code Artifacts**:
  - [Code Artifacts](https://youtu.be/GfTj7O4gmd0?si=WJbdnemZpJzBrJo3) allow creation of React, HTML, and Mermaid diagrams directly in chat

- 🎨 **Image Generation & Editing**
  - Text-to-image and image-to-image with [GPT-Image-1](https://www.librechat.ai/docs/features/image_gen#1--openai-image-tools-recommended)
  - Text-to-image with [DALL-E (3/2)](https://www.librechat.ai/docs/features/image_gen#2--dalle-legacy), [Stable Diffusion](https://www.librechat.ai/docs/features/image_gen#3--stable-diffusion-local), [Flux](https://www.librechat.ai/docs/features/image_gen#4--flux), or any [MCP server](https://www.librechat.ai/docs/features/image_gen#5--model-context-protocol-mcp)
  - Produce stunning visuals from prompts or refine existing images with a single instruction

- 💾 **Presets & Context Management**:
  - Create, Save, & Share Custom Presets
  - Switch between AI Endpoints and Presets mid-chat
  - Edit, Resubmit, and Continue Messages with Conversation branching
  - Create and share prompts with specific users and groups
  - [Fork Messages & Conversations](https://www.librechat.ai/docs/features/fork) for Advanced Context control

- 💬 **Multimodal & File Interactions**:
  - Upload and analyze images with Claude 3, GPT-4.5, GPT-4o, o1, Llama-Vision, and Gemini 📸
  - Chat with Files using Custom Endpoints, OpenAI, Azure, Anthropic, AWS Bedrock, & Google 🗃️
  - OpenAI/Azure model chats can now route chat-bar `File Search` to native OpenAI Files + Vector Stores while keeping LibreChat file tracking intact

## Provider-Native Chat-Bar Tools

LibreChat now supports provider-native routing for the chat input tool toggles in supported model chats.

This keeps the existing LibreChat badge/dropdown UX while allowing the selected provider to execute its own first-party tools when possible.

### Currently documented native routes

- OpenAI / Azure OpenAI
  - `Web Search` → OpenAI Responses API `web_search`
  - `Code Interpreter` → OpenAI `code_interpreter`
  - `File Search` → OpenAI Files + Vector Stores
- Google / Gemini
  - `Web Search` → Gemini `googleSearch`
  - `Code Interpreter` → Gemini `codeExecution`

### Important notes

- this behavior is centered on the ephemeral model-chat tool toggles in the chat bar
- native tool files remain tracked in LibreChat storage and metadata
- OpenAI-native file uploads are mirrored upstream lazily and cached for reuse
- Gemini native file search is not part of this implementation
- provider restrictions can still block a native tool even when LibreChat routes correctly

Documentation:

- user/behavior overview: [./OPENAI_GEMINI_NATIVE_TOOLS.md](./OPENAI_GEMINI_NATIVE_TOOLS.md)
- engineering implementation notes: [./OPENAI_GEMINI_NATIVE_TOOLS_IMPLEMENTATION.md](./OPENAI_GEMINI_NATIVE_TOOLS_IMPLEMENTATION.md)

- 🌎 **Multilingual UI**:
  - English, 中文 (简体), 中文 (繁體), العربية, Deutsch, Español, Français, Italiano
  - Polski, Português (PT), Português (BR), Русский, 日本語, Svenska, 한국어, Tiếng Việt
  - Türkçe, Nederlands, עברית, Català, Čeština, Dansk, Eesti, فارسی
  - Suomi, Magyar, Հայերեն, Bahasa Indonesia, ქართული, Latviešu, ไทย, ئۇيغۇرچە

- 🧠 **Reasoning UI**:
  - Dynamic Reasoning UI for Chain-of-Thought/Reasoning AI models like DeepSeek-R1

- 🎨 **Customizable Interface**:
  - Customizable Dropdown & Interface that adapts to both power users and newcomers

- 🌊 **[Resumable Streams](https://www.librechat.ai/docs/features/resumable_streams)**:
  - Never lose a response: AI responses automatically reconnect and resume if your connection drops
  - Multi-Tab & Multi-Device Sync: Open the same chat in multiple tabs or pick up on another device
  - Production-Ready: Works from single-server setups to horizontally scaled deployments with Redis

- 🗣️ **Speech & Audio**:
  - Chat hands-free with Speech-to-Text and Text-to-Speech
  - Automatically send and play Audio
  - Supports OpenAI, Azure OpenAI, and Elevenlabs
  - This branch also adds provider-brokered realtime voice sessions for OpenAI, Azure OpenAI, Gemini Live, and xAI-compatible endpoints
  - Background audio/video file transcription with OpenAI models (whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe, gpt-4o-transcribe-diarize): upload any audio or video file and a persistent conversation is created with the transcript; supports model/prompt selection, file chunking for large files, and speaker diarization
  - **Realtime guide:** [./REALTIME_VOICE.md](./REALTIME_VOICE.md)

- 📥 **Import & Export Conversations**:
  - Import Conversations from LibreChat, ChatGPT, Chatbot UI
  - Export conversations as screenshots, markdown, text, json

- 🔍 **Search & Discovery**:
  - Search all messages/conversations

- 👥 **Multi-User & Secure Access**:
  - Multi-User, Secure Authentication with OAuth2, LDAP, & Email Login Support
  - Built-in Moderation, and Token spend tools

- ⚙️ **Configuration & Deployment**:
  - Configure Proxy, Reverse Proxy, Docker, & many Deployment options
  - Use completely local or deploy on the cloud

- 📖 **Open-Source & Community**:
  - Completely Open-Source & Built in Public
  - Community-driven development, support, and feedback

[For a thorough review of our features, see our docs here](https://docs.librechat.ai/) 📚

## 🪶 All-In-One AI Conversations with LibreChat

LibreChat is a self-hosted AI chat platform that unifies all major AI providers in a single, privacy-focused interface.

Beyond chat, LibreChat provides AI Agents, Model Context Protocol (MCP) support, Artifacts, Code Interpreter, custom actions, conversation search, and enterprise-ready multi-user authentication.

Open source, actively developed, and built for anyone who values control over their AI infrastructure.

## ⏰ Scheduled Runs & Notifications

LibreChat now supports per-user scheduled runs from **Settings → Data → Scheduled runs**.

Users can automate agent runs or direct model prompts with cron expressions, then receive notifications by:

- email
- Twilio SMS
- carrier gateway email-to-text addresses such as `5551234567@txt.att.net`
- browser push notifications

For setup, environment variables, and local verification, see [`SCHEDULED_RUNS.md`](./SCHEDULED_RUNS.md).

---

## Local Docker Workflow

For this repo's local validation workflow, start the LibreChat stack in detached mode and then start the observability sidecars.

Detached containers continue running after you close the shell. The LibreChat repo services use Docker restart policies, and the local Prometheus sidecar should also be started from its compose file so it is managed by Docker instead of the shell.

Admin console observability links are host-aware: when LibreChat is opened on a host such as `http://192.168.50.4:3080`, the admin links use that same host instead of `localhost`.

### VS Code devcontainer persistence

If you open this repo with VS Code Dev Containers, the container lifecycle is controlled by `.devcontainer/devcontainer.json`.

This repo is now configured with:

```json
"shutdownAction": "none"
```

That tells VS Code not to stop the devcontainer compose project when the VS Code window closes.

The devcontainer compose services in `.devcontainer/docker-compose.yml` also use `restart: unless-stopped`, so they are left running unless you stop them explicitly.

After changing this file, reopen or rebuild the devcontainer once so VS Code picks up the new shutdown behavior.

To reconnect later, reopen the folder in VS Code and use **Dev Containers: Reopen in Container**.

### Optional LiteLLM bind-mounted files

The default local stack now runs without LiteLLM.

Only if you intentionally re-enable the `litellm` service should these paths exist as regular files before startup:

- `litellm/config.yaml`
- `litellm/custom_callbacks.py`

If either path is accidentally created as a directory, `litellm` will fail to start because Docker will bind-mount a directory at `/app/config.yaml` or `/app/custom_callbacks.py`.

### Start the full local stack

Recommended dual-rail startup from current repo source:

```bash
cd /pool/home/timeng/LibreChat-custom
./local-services/start-all.sh stable
./local-services/start-all.sh dev
```

Use `stable` as the primary rail (`r1`, `:3080`) and `dev` as the validation / warm rollover rail (`r2`, `:3081`).
Validate on `dev` first, keep `stable` serving traffic, and only rebuild `stable` after the `dev` rail passes.

Both rails run the core LibreChat services, but only `stable` owns the shared Langfuse + metrics stack. `dev` reuses the stable traceability services on host ports (`3000`, `9091`, `9090`, `3001`) instead of starting duplicate Langfuse or exporter containers.

Manual compose equivalent for the shared `stable` rail:

```bash
cd /pool/home/timeng/LibreChat-custom
docker compose -f docker-compose.yml -f docker-compose.local.override.yml up -d --build --force-recreate
docker compose -f "/pool/home/timeng/librechat_exporter/prometheus-dev/docker-compose.yml" up -d
LIBRECHAT_LOG_DIR=/pool/home/timeng/LibreChat-custom/logs docker compose -f "/pool/home/timeng/librechat_exporter/grafana-loki-dev/docker-compose.yml" up -d
```

This is the default path agents should use. It builds `librechat-local:latest` from `Dockerfile`, so the running container includes the latest local backend, frontend, and shared-package changes from this checkout.

`docker-compose.local.override.yml` is intentionally checked into this worktree so restart/rebuild flows do not depend on the upstream-sync worktree's `docker-compose.override.yml` symlink.

On `stable`, the local override also starts `langfuse-model-pricing-sync`, which continuously seeds missing Langfuse model pricing from this branch's configured provider model lists, custom endpoint defaults, generalized xAI/Grok family patterns, and free local Ollama models. The same service also loads `./langfuse/.env` so it can backfill historical Langfuse generations in ClickHouse when pricing or token counts were missing at ingest time. LibreChat and Touchdown Azure traces now use `azure-openai/<deployment>` Langfuse model aliases, and the shared pricing config for those aliases belongs in `./langfuse/.env` via `AZURE_OPENAI_MODELS` plus optional `LANGFUSE_MODEL_ALIAS_MAP` entries.

The Grafana/Loki sidecar should always follow `/pool/home/timeng/LibreChat-custom/logs` for this worktree so Grafana shows the current customization-stack logs. The same Promtail stack also mounts `/pool/home/timeng/touchdown/logs` and `/pool/home/timeng/touchdown/logs_backward` by default so the shared Grafana/Loki environment covers Touchdown and Backwards Touchdown too.

The Langfuse stack on port `3000` is also the shared tracing backend for Touchdown host runtimes. Reuse the same `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` values from `./langfuse/.env` when wiring Touchdown services, and use a `LANGFUSE_BASE_URL` that is reachable from both host processes and optional containers.

The linked dashboards then resolve on the same host as LibreChat:

- Langfuse: `http://<same-host>:3000`
- Grafana: `http://<same-host>:3001`
- Metrics: `http://<same-host>:9091`
- Prometheus: `http://<same-host>:9090`

Stock upstream app image, only when explicitly requested:

```bash
cd /pool/home/timeng/LibreChat-custom
docker compose -f docker-compose.yml up -d
docker compose -f "/pool/home/timeng/librechat_exporter/prometheus-dev/docker-compose.yml" up -d
LIBRECHAT_LOG_DIR=/pool/home/timeng/LibreChat-custom/logs TOUCHDOWN_LOG_DIR=/pool/home/timeng/touchdown/logs TOUCHDOWN_BACKWARDS_LOG_DIR=/pool/home/timeng/touchdown/logs_backward docker compose -f "/pool/home/timeng/librechat_exporter/grafana-loki-dev/docker-compose.yml" up -d
```

Optional admin-only patched-remote fast path:

```bash
cd /pool/home/timeng/LibreChat-custom
docker compose -f docker-compose.yml -f docker-compose.local.override.yml -f docker-compose.remote-patched.override.yml up -d --build --force-recreate
docker compose -f "/pool/home/timeng/librechat_exporter/prometheus-dev/docker-compose.yml" up -d
LIBRECHAT_LOG_DIR=/pool/home/timeng/LibreChat-custom/logs TOUCHDOWN_LOG_DIR=/pool/home/timeng/touchdown/logs TOUCHDOWN_BACKWARDS_LOG_DIR=/pool/home/timeng/touchdown/logs_backward docker compose -f "/pool/home/timeng/librechat_exporter/grafana-loki-dev/docker-compose.yml" up -d
```

### Restart the full local stack

Preferred warm-rollover workflow:

```bash
cd /pool/home/timeng/LibreChat-custom
./local-services/start-all.sh dev
./local-services/status-all.sh all
# validate dev on :3081 while stable stays live on :3080
./local-services/start-all.sh stable
./local-services/status-all.sh all
```

That keeps `dev` (`r2`) warm while `stable` (`r1`) is rebuilt.

Manual full restart:

```bash
cd /pool/home/timeng/LibreChat-custom
docker compose -f docker-compose.yml -f docker-compose.local.override.yml down
docker compose -f docker-compose.yml -f docker-compose.local.override.yml up -d --build --force-recreate
docker compose -f "/pool/home/timeng/librechat_exporter/prometheus-dev/docker-compose.yml" down
docker compose -f "/pool/home/timeng/librechat_exporter/prometheus-dev/docker-compose.yml" up -d
docker compose -f "/pool/home/timeng/librechat_exporter/grafana-loki-dev/docker-compose.yml" down
LIBRECHAT_LOG_DIR=/pool/home/timeng/LibreChat-custom/logs TOUCHDOWN_LOG_DIR=/pool/home/timeng/touchdown/logs TOUCHDOWN_BACKWARDS_LOG_DIR=/pool/home/timeng/touchdown/logs_backward docker compose -f "/pool/home/timeng/librechat_exporter/grafana-loki-dev/docker-compose.yml" up -d
```

### Quick verification

```bash
cd /pool/home/timeng/LibreChat-custom
./local-services/status-all.sh all
curl -fsS http://127.0.0.1:3080 >/dev/null && echo "LibreChat OK"
curl -fsS http://127.0.0.1:3081 >/dev/null && echo "LibreChat dev OK"
curl -fsS http://192.168.50.201:11434/api/tags >/dev/null && echo "Remote Ollama OK"
systemctl --user is-active librechat-ollama-keepwarm.timer >/dev/null && echo "Ollama keep-warm timer OK"
status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/api/admin/permissions)
if [ "$status" = "401" ] || [ "$status" = "403" ]; then echo "Admin route exists"; fi
schedule_status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/api/schedules)
if [ "$schedule_status" = "401" ]; then echo "Scheduled runs route exists"; fi
realtime_status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/api/realtime/models)
if [ "$realtime_status" = "401" ]; then echo "Realtime route exists"; fi
realtime_status_dev=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3081/api/realtime/models)
if [ "$realtime_status_dev" = "401" ]; then echo "Realtime dev route exists"; fi
curl -fsS http://127.0.0.1:3000 >/dev/null && echo "Langfuse OK"
curl -fsS http://127.0.0.1:9090/-/ready >/dev/null && echo "Prometheus OK"
curl -fsS http://127.0.0.1:3100/ready >/dev/null && echo "Loki OK"
curl -fsS http://127.0.0.1:3001 >/dev/null && echo "Grafana OK"
```

### Realtime voice notes

- Realtime voice lives behind the chat-input **Realtime Voice** dialog.
- The microphone remains disabled until a realtime session is connected.
- If the dialog shows a provider as unavailable, save the required provider key first, then reopen the dialog.
- Full setup and troubleshooting: [./REALTIME_VOICE.md](./REALTIME_VOICE.md)

- The default local app image definition lives in `Dockerfile` and is wired into `docker-compose.local.override.yml`.
- If you ask an agent to start or restart LibreChat locally, it should use the default local-build path above instead of the published upstream image.
- MongoDB data persists across rebuilds through `./data-node:/data/db` from `docker-compose.yml`.

For the admin-only patched-remote reference, see `PATCHED_REMOTE_IMAGE_REFERENCE.md`. For the current default local workflow, see `LOCAL_SERVICE_RUNBOOK.local.md`.

### MCP interoperability notes for this branch

This branch includes additional MCP compatibility work beyond upstream LibreChat.

- Bare no-input MCP tool schemas are normalized to include `properties: {}` before OpenAI-compatible tool calling so GPT-5 style function validation accepts them.
- Arcade-style OAuth refresh now uses protected-resource `authorization_servers` metadata to discover the token endpoint instead of guessing from the MCP server path.
- MCP OAuth callbacks now resolve from `DOMAIN_SERVER` first, then forwarded/request host data. The local Docker override sets `DOMAIN_SERVER=http://localhost:${PORT:-3080}` so local Arcade Microsoft OAuth can use the loopback redirect exception.
- Live local validation connected to Arcade `microsoft-tools`, listed 24 tools, and advanced `MicrosoftOnedrive_WhoAmI` plus `MicrosoftOnedrive_GetMyDrive` to provider authorization prompts instead of LibreChat MCP initialization errors.
- The local runtime also configures a read-only `internet-archive` MCP server at `http://192.168.50.4:8770/mcp` for Wayback Machine and archive.org research tools; see `INTERNET_ARCHIVE_MCP.md`.

For the detailed local-runtime version of these notes, see `README.local.md` and `CUSTOMIZATION_MASTER_DOC.md`.

### Default model access for new non-admin users

This local setup now assigns default per-user model restrictions to newly created non-admin accounts instead of globally shrinking the configured provider model lists.

- Default new non-admin access:
  - `azureOpenAI`: all models
  - `ollama`: all discovered Ollama models
  - `openAI`: `gpt-5.3-chat-latest`, `gpt-5.4-mini`, `gpt-5.4-nano`
  - `anthropic`: Claude Sonnet 4.5/4.6, all Haiku, all Claude 3.x (no Opus)
  - `xai`: `grok-4-1-fast`
- Admins keep the full configured model catalog.
- Existing users are not changed automatically.
- The canonical default allowlist is defined in `api/server/services/ModelAccess.js` (`DEFAULT_NON_ADMIN_MODEL_PERMISSIONS`).

Use the admin console `Users -> Model access` controls if you want to override a specific user's defaults after account creation.

### Google Gemini model discovery and grounding notes

The Google endpoint now supports API-driven Gemini model discovery and capability-aware settings, alongside the existing grounding-to-citations flow.

- If `GOOGLE_MODELS` is unset and `GOOGLE_KEY` is configured, LibreChat now queries Google's `v1beta/models` endpoint and builds the Google model picker from the live API response.
- Only text-compatible Google models are included. Embedding, TTS, image-generation, video, and other non-chat models are filtered out before the list reaches the UI.
- The startup config now includes per-model Google capability metadata so the settings panel can react to the selected model.
- Unsupported controls are rendered as read-only with an inline reason instead of silently accepting values that the selected model ignores.
- Capability-aware defaults and limits are applied for `temperature`, `topP`, `topK`, and `maxOutputTokens` when Google returns those limits.
- Gemini 3-style models use `thinkingLevel`, while Gemini 2.5-style models continue using `thinkingBudget`.
- The Google settings panel exposes the `Grounding with Google Search` toggle through the normal parameter renderer only when the selected model supports it.
- When Gemini returns grounding metadata, LibreChat maps it into the existing `Sources` panel and inline citation markers instead of requiring a separate search-result UI.
- Multipart Gemini responses are supported, so inline citations can still appear when the final answer is split across multiple text parts.
- Citation placement now prefers exact grounded segment text and natural sentence or section endings when Google's raw indices drift, which avoids mid-word markers in grounded replies.
- Grounding metadata is preserved through the agents response pipeline before the final message is saved and sent to the client.
- Older saved messages do not retroactively gain citations; send a fresh grounded prompt after rebuilding or redeploying.

If you still want a fixed Google model list, keep using `GOOGLE_MODELS`; the manual env var continues to override live discovery.

If grounding is enabled but a reply still looks stale, verify that the selected Gemini model supports Google Search grounding, then retry with a fresh prompt that clearly needs current web information. Gemini may decide not to search on every prompt even when the toggle is enabled.

### Google authentication modes

This branch supports three Google/Vertex AI authentication modes for chat, realtime voice, and image generation:

- **API key**: set `GOOGLE_KEY` or save a user key in LibreChat settings (default behavior)
- **Vertex AI service account**: set `GOOGLE_AUTH_MODE=vertex_service_account` and provide a service account JSON via `GOOGLE_SERVICE_KEY_FILE` or by uploading it in the Google endpoint settings UI
- **Vertex AI application default credentials (ADC)**: set `GOOGLE_AUTH_MODE=vertex_application_default` and ensure `GOOGLE_APPLICATION_CREDENTIALS` is set or `gcloud auth application-default login` has been run on the host

If `GOOGLE_AUTH_MODE` is omitted, LibreChat auto-detects from `GOOGLE_KEY` → `GOOGLE_SERVICE_KEY_FILE` → `GOOGLE_APPLICATION_CREDENTIALS`. Vertex modes also require a Google Cloud project ID (auto-detected from service account JSON, or set via `GOOGLE_VERTEX_PROJECT` / `GOOGLE_CLOUD_PROJECT`). Region defaults to `us-central1` unless overridden by `GOOGLE_VERTEX_LOCATION`.

The Google endpoint settings dialog includes an auth mode dropdown with conditional field rendering based on the selected mode.

### xAI custom endpoint discovery and settings notes

LibreChat now gives detected xAI custom endpoints their own live model discovery and capability-aware settings flow instead of treating them as a generic OpenAI-compatible endpoint.

- xAI endpoints are auto-detected from an `xai` endpoint name, an `*.x.ai` base URL, or an explicit `customParams.defaultParamsEndpoint: 'xai'` override.
- Detected xAI endpoints with `models.fetch: true` query `${baseURL}/language-models` and build the picker from text-compatible models only.
- xAI aliases are preserved in the local capability map, so canonical IDs and current alias names both resolve correctly in the picker/settings flow.
- Startup config now includes `xaiModelCapabilities` per custom endpoint, and cached startup/model config refreshes xAI capabilities and model lists on later requests.
- The xAI settings surface exposes `temperature`, `top_p`, `max_tokens`, `stop`, `imageDetail`, `reasoning_effort`, `useResponsesApi`, `web_search`, `verbosity`, and `disableStreaming`.
- Unsupported controls stay visible but become read-only with an inline reason in the endpoint settings modal, the normal parameter side panel, and the agent model panel.
- `reasoning_effort` is only enabled for `grok-3-mini*` models.
- reasoning-capable xAI models disable `stop`, and multi-agent Grok 4.20 models disable `max_tokens`.
- xAI requests default to Responses API semantics and strip unsupported fields such as penalties on Responses-style requests, unsupported reasoning effort, and multi-agent output-token limits.

Recommended custom-endpoint pattern:

```yaml
endpoints:
  custom:
    - name: 'xai'
      apiKey: '${XAI_API_KEY}'
      baseURL: 'https://api.x.ai/v1'
      customParams:
        defaultParamsEndpoint: 'xai'
      models:
        fetch: true
```

The local customization runtime now also includes a dedicated `xai` custom endpoint in `librechat.yaml` with a user-provided key flow, bootstrap default models, and `fetch: true`. That keeps xAI visible before a key is entered, then automatically refreshes the selector from `/language-models` after the user saves their xAI key.

If you proxy xAI through a non-`x.ai` hostname, force the xAI settings profile explicitly:

```yaml
endpoints:
  custom:
    - name: 'My Grok Proxy'
      apiKey: '${XAI_API_KEY}'
      baseURL: 'https://my-proxy.example.com/v1'
      customParams:
        defaultParamsEndpoint: 'xai'
      models:
        fetch: true
```

Guide: [./XAI_CUSTOM_ENDPOINTS.md](./XAI_CUSTOM_ENDPOINTS.md)

### Azure direct endpoint notes

LibreChat now supports the built-in `azureOpenAI` endpoint with per-user direct Azure OpenAI or Azure AI Foundry credentials.

- To expose the endpoint for user-managed credentials, set `AZURE_API_KEY=user_provided` and `AZURE_OPENAI_BASEURL=user_provided`.
- Users can then save an Azure API key plus either an Azure OpenAI base URL such as `https://<resource>.openai.azure.com/openai/v1` or an Azure AI Foundry project URL such as `https://<resource>.services.ai.azure.com/api/projects/<project>/openai/v1`.
- Model discovery now uses Azure's OpenAI-compatible `GET /models` flow when the configured endpoint supports it.
- When live discovery is unavailable, the Azure key dialog accepts comma-separated deployment names as a manual fallback.
- Reopening the Azure settings cog now reloads the saved endpoint, key, and optional deployment list so users can update only the field they need.
- Saved user-provided Azure configs are loaded into the model picker per user, without overwriting the shared cached model list for other users.

### Local Ollama model discovery notes

LibreChat now treats the dedicated `Ollama` custom endpoint as a live tag-discovered source when `models.fetch: true` is enabled.

- For the `Ollama` custom endpoint, LibreChat checks every configured Ollama URL in `baseURL` plus optional `baseURLs`.
- For each configured Ollama URL, LibreChat first tries `/api/tags` and then falls back to the same host's root `/models` endpoint when the server is OpenAI-compatible or router-style instead of native Ollama tags.
- When multiple Ollama URLs are configured, LibreChat merges the discovered model IDs into a single `Ollama` picker.
- If the same model ID exists on more than one configured Ollama URL, the first URL in config order wins request routing for that model.
- The dedicated Ollama endpoint also no longer falls back to `models.default` when live tag discovery returns an empty list. This prevents stale placeholder models from appearing as selectable when they are not actually installed.
- Cached model config now refreshes the dedicated `Ollama` endpoint from the merged live discovery results, so newly pulled or removed models are reflected without relying on a stale cached list.
- If Ollama reports no tags, the endpoint can appear empty and may be hidden by the client until at least one model is installed.
- LiteLLM is disabled in the default local stack. Re-enable it only if you specifically need an OpenAI-compatible proxy layer for non-Ollama providers or aliases.
- The local service helpers now warm `gptossbigctx:latest` on the remote Ollama host and keep it loaded with a user-level systemd timer.

Recommended local custom-endpoint pattern:

```yaml
endpoints:
  custom:
    - name: 'Ollama'
      apiKey: '${OLLAMA_MULTI_API_KEY}'
      baseURL: 'http://192.168.50.201:11434/v1/'
      baseURLs:
        - 'http://192.168.50.4:8080/v1/'
      models:
        default:
          - 'gptossbigctx:latest'
        fetch: true
```

With that configuration, the remote Ollama server stays authoritative for `gptossbigctx:latest` while the local llama.cpp router still contributes its faster local-only models through merged discovery. The `default` list is only a YAML bootstrap value. The actual selectable models come from the merged live discovery results across both Ollama-compatible URLs. When LibreChat is running in Docker, make sure any local llama.cpp router URL uses a host-reachable address such as the server IP instead of `127.0.0.1`.

### Ollama hosted web search modes

For chats using the dedicated `Ollama` custom endpoint, `Tools -> Web Search` now supports:

- `librechat`: LibreChat's standard web-search stack
- `ollama_native`: direct Ollama-hosted `web_search` and `web_fetch`
- `ollama_mcp`: the same Ollama-hosted tools exposed through a hidden MCP server

Notes:

- `ollama_native` is the default mode for Ollama chats
- native and MCP Ollama modes require `OLLAMA_API_KEY` on the LibreChat server
- the search backend is hosted by Ollama even when the selected model itself is local
- official references and privacy / retention notes are documented in [./OLLAMA_WEB_SEARCH.md](./OLLAMA_WEB_SEARCH.md)

### Ollama reasoning settings

For chats on the dedicated `Ollama` custom endpoint, LibreChat now uses an Ollama-specific reasoning profile instead of exposing the full OpenAI reasoning surface.

- supported values are `auto`, `none`, `low`, `medium`, and `high`
- `reasoning_summary` is not shown for Ollama chats
- `verbosity` is still passed through to Ollama
- legacy saved values are normalized (`minimal -> low`, `xhigh -> high`)
- when reasoning is set to `none`, LibreChat suppresses streamed reasoning deltas and hides leftover Ollama reasoning blocks in the UI

Guide: [./OLLAMA_REASONING.md](./OLLAMA_REASONING.md)

Expected merged `Ollama` picker entries for the current local setup:

- Remote Ollama examples: `hf.co/unsloth/GLM-4.7-Flash-GGUF:UD-Q2_K_XL`, `glm-4.7-flash:latest`, `gptossbigctx:latest`, `qwen3:14b`, `deepseek-r1:14b`, `qwen2.5-coder:14b`, `qwen2.5:14b`, `qwen2.5-coder:latest`, `qwen2.5:latest`, `gpt-oss:20b`, `gemma3:latest`, `gemini-3-flash-preview:latest`, `qwen3-coder:latest`, `llama3:latest`
- Local llama.cpp router entries: `qwen2.5-7b-instruct`, `qwen2.5-14b-instruct-q3`, `qwen2.5-14b-instruct-q4`, `mistral-7b-instruct-v0.3`, `phi-3.5-mini-instruct`, `gemma-2-9b-instruct`, `llama-3.1-8b-instruct`, `deepseek-r1-distill-qwen-7b`, `falcon3-10b-instruct`
- You should not see the internal router placeholder model ID `default`.

---

## 🌐 Resources

**GitHub Repo:**

- **RAG API:** [github.com/danny-avila/rag_api](https://github.com/danny-avila/rag_api)
- **Website:** [github.com/LibreChat-AI/librechat.ai](https://github.com/LibreChat-AI/librechat.ai)

**Other:**

- **Website:** [librechat.ai](https://librechat.ai)
- **Documentation:** [librechat.ai/docs](https://librechat.ai/docs)
- **Scheduled Runs Guide:** [./SCHEDULED_RUNS.md](./SCHEDULED_RUNS.md)
- **xAI Custom Endpoint Guide:** [./XAI_CUSTOM_ENDPOINTS.md](./XAI_CUSTOM_ENDPOINTS.md)
- **Ollama Web Search Guide:** [./OLLAMA_WEB_SEARCH.md](./OLLAMA_WEB_SEARCH.md)
- **Ollama Reasoning Guide:** [./OLLAMA_REASONING.md](./OLLAMA_REASONING.md)
- **Blog:** [librechat.ai/blog](https://librechat.ai/blog)

---

## 📝 Changelog

Keep up with the latest updates by visiting the releases page and notes:

- [Releases](https://github.com/danny-avila/LibreChat/releases)
- [Changelog](https://www.librechat.ai/changelog)

**⚠️ Please consult the [changelog](https://www.librechat.ai/changelog) for breaking changes before updating.**

---

## ⭐ Star History

<p align="center">
  <a href="https://star-history.com/#danny-avila/LibreChat&Date">
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=danny-avila/LibreChat&type=Date&theme=dark" onerror="this.src='https://api.star-history.com/svg?repos=danny-avila/LibreChat&type=Date'" />
  </a>
</p>
<p align="center">
  <a href="https://trendshift.io/repositories/4685" target="_blank" style="padding: 10px;">
    <img src="https://trendshift.io/api/badge/repositories/4685" alt="danny-avila%2FLibreChat | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/>
  </a>
  <a href="https://runacap.com/ross-index/q1-24/" target="_blank" rel="noopener" style="margin-left: 20px;">
    <img style="width: 260px; height: 56px" src="https://runacap.com/wp-content/uploads/2024/04/ROSS_badge_white_Q1_2024.svg" alt="ROSS Index - Fastest Growing Open-Source Startups in Q1 2024 | Runa Capital" width="260" height="56"/>
  </a>
</p>

---

## ✨ Contributions

Contributions, suggestions, bug reports and fixes are welcome!

For new features, components, or extensions, please open an issue and discuss before sending a PR.

If you'd like to help translate LibreChat into your language, we'd love your contribution! Improving our translations not only makes LibreChat more accessible to users around the world but also enhances the overall user experience. Please check out our [Translation Guide](https://www.librechat.ai/docs/translation).

---

## 💖 This project exists in its current state thanks to all the people who contribute

<a href="https://github.com/danny-avila/LibreChat/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=danny-avila/LibreChat" />
</a>

---

## 🎉 Special Thanks

We thank [Locize](https://locize.com) for their translation management tools that support multiple languages in LibreChat.

<p align="center">
  <a href="https://locize.com" target="_blank" rel="noopener noreferrer">
    <img src="https://github.com/user-attachments/assets/d6b70894-6064-475e-bb65-92a9e23e0077" alt="Locize Logo" height="50">
  </a>
</p>
