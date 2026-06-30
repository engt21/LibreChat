# Realtime Voice Guide

This branch adds a provider-brokered realtime voice mode to LibreChat.

## What it supports

- OpenAI realtime models
- Azure OpenAI realtime deployments
- Gemini Live
- xAI realtime-compatible voice endpoints

LibreChat exposes these through a single **Realtime Voice** dialog in the chat input.

Completed realtime sessions are also persisted back into LibreChat as normal conversations, so they appear in the left sidebar and reopen like any other saved chat.

## Important behavior

The microphone is intentionally unavailable until a realtime session is connected.

If you see the mic as disabled, the usual cause is:

1. the app was not restarted after pulling/building changes, or
2. no realtime provider/model is currently connected, or
3. the selected provider still needs credentials.

## How to use it

1. Start the local/dev stack when you need a running app instance:

   ```bash
   cd /pool/home/timeng/LibreChat-custom
   ./local-services/start-all.sh
   ```

   If the stack is already running and you changed only backend/config/runtime-loaded files, prefer a fast runtime-delta deploy:

   ```bash
   cd /pool/home/timeng/LibreChat-custom
   ./local-services/deploy-runtime-delta.sh dev --dry-run -- <paths>
   ./local-services/deploy-runtime-delta.sh dev -- <paths>
   ```

   Use a clean rebuild/restart only when the helper refuses the changed paths or dependencies, Dockerfiles, compose/container shape, package source, or frontend source require fresh artifacts:

   ```bash
   cd /pool/home/timeng/LibreChat-custom
   ./local-services/stop-all.sh
   ./local-services/start-all.sh
   ```

2. Open LibreChat at `http://localhost:3080`.
3. Sign in.
4. In the chat input, click the **Realtime Voice** button.
5. Pick a provider and realtime-capable model.
6. Click **Connect**.
7. After the dialog status changes to `connected`, click **Start mic**.
8. Speak, or type into the dialog and send text turns.
9. Disconnect or close the dialog to save the captured realtime transcript into the sidebar.

## Provider setup

### OpenAI

- Works with a server key via `OPENAI_API_KEY`, or
- with a user-saved key when the environment is configured for user-provided credentials.

### Azure OpenAI

- Requires an Azure API key and a compatible base URL / deployment.
- If using user-provided Azure credentials, save them in LibreChat settings first.

### Gemini Live

- Requires a configured Google authentication mode. Supported modes:
  - **API key**: set `GOOGLE_KEY`, or save a user key in LibreChat settings
  - **Vertex AI service account**: set `GOOGLE_AUTH_MODE=vertex_service_account` and provide a service account JSON via `GOOGLE_SERVICE_KEY_FILE` or user upload
  - **Vertex AI ADC**: set `GOOGLE_AUTH_MODE=vertex_application_default` and ensure `GOOGLE_APPLICATION_CREDENTIALS` is set or `gcloud auth application-default login` has been run
- Vertex modes also require a Google Cloud project ID (from the service account JSON, `GOOGLE_VERTEX_PROJECT`, or `GOOGLE_CLOUD_PROJECT`) and optionally a region (`GOOGLE_VERTEX_LOCATION`, defaults to `us-central1`)
- If `GOOGLE_AUTH_MODE` is omitted, LibreChat auto-detects from `GOOGLE_KEY` → `GOOGLE_SERVICE_KEY_FILE` → `GOOGLE_APPLICATION_CREDENTIALS`

### xAI

- Requires a configured xAI-style custom endpoint plus credentials.
- In this branch, the default `xai` custom endpoint is present, but if it is marked `user_provided` then you must save your key in LibreChat before connecting.

## Quick verification

The realtime HTTP route should exist and return `401 Unauthorized` before login:

```bash
curl -i http://127.0.0.1:3080/api/realtime/models
```

That confirms the route is mounted. After you log into the UI, the dialog fetches the same route with your session token and uses:

- `GET /api/realtime/models`
- `WS /api/realtime/ws`
- `POST /api/realtime/conversation`

## Troubleshooting

### Microphone button is disabled

This is expected until **Connect** succeeds.

Checklist:

- restart the stack
- reopen LibreChat
- open **Realtime Voice**
- select an available provider/model
- click **Connect** first
- only then click **Start mic**

### Provider shows unavailable

The backend returns provider availability based on configured keys or saved user keys.

If a provider is shown with a reason like “Add your key in LibreChat settings,” save the key there first and reopen the dialog.

## Recent fixes in this branch

- The provider/model/voice picker now keeps its local selection stable instead of re-deriving it on every async refresh.
- The model and voice selectors now use in-dialog custom popovers instead of native `<select>` menus, which stops the picker from collapsing immediately inside the modal.
- Failed realtime connects now fall back to `idle` instead of leaving the dialog stuck in `connecting`.
- Realtime websocket auth now refreshes short-lived access tokens before connect and the backend can fall back to authenticated cookies when a stale query token is presented.
- Realtime sessions no longer self-close during the initial connect path; the hook cleanup now only tears sessions down on unmount instead of on every callback identity change.
- Realtime sessions now persist their finalized transcript back into standard LibreChat conversations when you disconnect, reconnect to a new live session, or close the dialog.
- Assistant transcript assembly now prefers the best available source without duplicating final output on `response.done`.
- Microphone startup errors are surfaced to the user instead of failing silently.
- Live mic capture is muted locally so captured audio is not routed back to speakers.
- Azure realtime availability now reflects whether usable Azure credentials were actually resolved.
- Azure realtime no longer hardcodes `gpt-4o-mini-transcribe` for every deployment.
- xAI realtime providers now prefer discovered realtime-capable models and validate the selected model at session start.
- Gemini's stop control is labeled honestly as local audio stop because server-side reply cancellation is not available through the current Gemini Live path.

## Implementation lessons carried forward

Lessons reinforced by earlier local work on model-picker behavior, native provider tools, xAI endpoint parity, and scheduled-run/admin features:

- Keep transient picker state local and stable; do not continually recompute controlled UI state from async config payloads.
- Avoid native browser selects inside this dialog path when modal/focus behavior makes them unreliable; keep the picker fully owned inside the dialog tree.
- Only surface a provider as available after validating the actual runtime credentials/config, not just the existence of model names.
- Realtime websocket auth should not rely on a single in-memory access token path; same-origin authenticated cookies are an important fallback for long-lived chat sessions.
- Cleanup effects that own live transports must not depend directly on frequently recreated callbacks, or they can close sockets during connection startup.
- If a live modality should behave like normal chat history, persist it through the same conversation-import path instead of inventing a parallel storage surface.
- Prefer live capability/model discovery over hardcoded provider assumptions whenever an API already exposes that metadata.
- Match the UI affordance to the provider's real behavior so controls do not promise features the backend cannot actually perform.

### Route check fails

Use:

```bash
cd /pool/home/timeng/LibreChat-custom
./local-services/status-all.sh
docker logs --tail 100 LibreChat
```

## Local runtime note

Small realtime backend/config changes can become live through `local-services/deploy-runtime-delta.sh` plus the API restart it performs. Rebuild the local app image only for dependency/image/container-shape changes or when the helper refuses the surface. Realtime frontend source changes still require a complete `client/dist` build and deployment through `local-services/deploy-built-client-dist.sh`.
