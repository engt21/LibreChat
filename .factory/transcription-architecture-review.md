# Audio Transcription Architecture Deep Review

## Question 1: TranscriptionSettings.tsx — Session-Level UI

**File:** `client/src/components/Endpoints/Settings/TranscriptionSettings.tsx`

### Structure
This is a **conversation-level settings panel** rendered inside the endpoint settings sidebar. It manages three pieces of state on the `conversation` object:

| State Field | Type | Storage |
|---|---|---|
| `transcriptionModel` | `string` | `conversation.transcriptionModel` via `setOption('transcriptionModel')` |
| `transcriptionPrompt` | `string` | `conversation.transcriptionPrompt` via `setOption('transcriptionPrompt')` |
| `transcriptionSpeakerReferences` | `TTranscriptionSpeakerReference[]` | `conversation.transcriptionSpeakerReferences` via `setOption('transcriptionSpeakerReferences')` |

### UI Sections
1. **Model Dropdown** (line ~195): Uses `<Dropdown>` from `@librechat/client` with `transcriptionModelOptions` (Whisper-1, GPT-4o Transcribe, GPT-4o Mini Transcribe, GPT-4o Diarize).
2. **Prompt Textarea** (line ~207): `<TextareaAutosize>` disabled when `DIARIZE_TRANSCRIPTION_MODEL` is selected (diarize doesn't support prompts).
3. **Speaker References Panel** (line ~223): Only visible when `diarizeEnabled === true`. Supports up to 4 speaker clips with upload/replace/remove. Uses `useUploadTranscriptionReferenceMutation` to upload clips via `POST /api/files/transcription-reference`.

### How it saves
Uses `setOption` from `TSettingsProps`, which directly updates the conversation object. Changes are persisted with the conversation (not localStorage).

---

## Question 2: AttachFileMenu.tsx — File Attachment Flow

**File:** `client/src/components/Chat/Input/Files/AttachFileMenu.tsx`

### Structure
An `<Ariakit.MenuButton>` dropdown that shows file upload options. It wraps a hidden `<FileUpload>` input element.

### File type routing (line ~107-165)
The menu builds items dynamically based on endpoint capabilities:
- **Provider upload** (`image_document_video_audio`): For endpoints supporting docs (includes audio/video)
- **Image upload** (`image`): For basic endpoints
- **OCR/text** (`EToolResources.context`)
- **File search** (`EToolResources.file_search`)
- **Code files** (`EToolResources.execute_code`)

### Key flow
1. User clicks menu item → `handleUploadClick()` sets the hidden input's `accept` attribute and triggers `.click()`
2. File selection triggers `handleFileChange(e, toolResource)` from `useFileHandling` hook
3. The hook's `uploadFile` mutation handles the actual upload

**Important:** Audio/video files are accepted through the "Provider upload" path with `accept="image/*,.heif,.heic,.pdf,application/pdf,video/*,audio/*"`.

---

## Question 3: Chat Compose Area Component Tree

**Directory:** `client/src/components/Chat/Input/`

### Full component tree in ChatForm.tsx (the compose area):
```
<form>                           ← ChatForm.tsx (line 40)
  └─ div.relative.flex
     └─ div.flex.w-full
        ├─ <Mention> (+ popover)
        ├─ <Mention> (@ popover)
        ├─ <PromptsCommand>
        └─ div.rounded-3xl.border  ← The main compose box
           ├─ <TextareaHeader>      ← Header row with convo controls
           ├─ <EditBadges>          ← Badge editing UI
           ├─ <FileFormChat>        ← ★ FILE PREVIEW ROW (renders FileRow)
           ├─ div.flex              ← Textarea row
           │  ├─ <TextareaAutosize> ← The actual text input
           │  └─ <CollapseChat>
           └─ div.flex.gap-2        ← Bottom toolbar row
              ├─ <AttachFileChat>   ← Attach button (left)
              ├─ <BadgeRow>         ← Feature badges (web search, MCP, etc.)
              ├─ <AudioRecorder>    ← Voice recording button
              ├─ <RealtimeButton>
              └─ <SendButton>/<StopButton> ← Submit button (right)
```

### Recommended insertion point for inline transcription controls
**Between `<FileFormChat>` and the textarea row**, or as an expansion of `<FileFormChat>` that conditionally renders transcription controls when an audio/video file is present. This is the natural location because:
1. Files are already previewed there via `FileRow`
2. It's above the textarea, visible but not blocking input
3. It follows the existing pattern of contextual UI appearing based on attached content

---

## Question 4: Auto-Transcription Logic in useFileHandling.ts

**File:** `client/src/hooks/Files/useFileHandling.ts`

### `shouldAutoTranscribe` (line 398-403)
```typescript
const shouldAutoTranscribe =
  variables.get('message_file') === 'true' &&
  !assistant_id &&
  !toolResource &&
  !isAssistantsEndpoint(endpointType ?? endpoint) &&
  isTranscribableMediaUpload({ filename, type });
```
Conditions: file is a message attachment (not tool resource), not an assistant, and file is audio/video.

### `isTranscribableMediaUpload` (line 74-78)
```typescript
const isTranscribableMediaUpload = ({ filename, type }) =>
  Boolean(
    (type && (type.startsWith('audio/') || type.startsWith('video/'))) ||
    (filename && transcribableMediaPattern.test(filename)),
  );
```

### `startQueuedTranscription` (line 259-349)
Called immediately after upload succeeds (line 410). It:
1. Resolves effective model: `conversation?.transcriptionModel || globalTranscriptionModel || undefined` (line 275-276)
2. Resolves effective prompt: `conversation?.transcriptionPrompt || globalTranscriptionPrompt || undefined` (line 277-278)
3. Builds payload with `file_id`, endpoint, model, `transcriptionModel`, `prompt`, `speakerReferences`
4. Calls `dataService.startAudioTranscription(payload)` → `POST /api/files/transcribe`
5. Receives back `{ conversation, messages, responseMessageId }`
6. Updates query cache, navigates to conversation, starts polling for result
7. Removes file preview from compose area

### To disable auto-transcription
Set `shouldAutoTranscribe = false` (or add a condition like `!hasAudioFilesPendingManualTranscription`). The file would then stay in the compose area's `FileRow` preview instead of being immediately consumed.

---

## Question 5: File Preview Components

**Directory:** `client/src/components/Chat/Input/Files/`

### How files show in compose area after upload:

1. **FileFormChat.tsx** — Wrapper that renders `<FileRow>` with conversation files
2. **FileRow.tsx** (line 84-135) — Iterates files, renders:
   - `<Image>` for `file.type?.startsWith('image')` — thumbnail preview with delete button
   - `<FileContainer>` for everything else — icon + filename + type label with delete button
3. **FileContainer.tsx** — Shows `<FilePreview>` (icon) + filename + file type title
4. **FilePreview.tsx** — Renders `<FileIcon>` with a source badge and progress spinner
5. **Image.tsx** — Renders `<ImagePreview>` with a `<RemoveFile>` button

### Current audio file appearance
Audio files render as a **FileContainer** (generic file card with icon + filename). There is **no special audio preview** — no waveform, no playback controls, no transcription options.

### Opportunity
When an audio/video file is detected in `FileRow`, instead of (or in addition to) rendering a plain `<FileContainer>`, render an `<AudioTranscriptionCard>` that includes the inline transcription controls.

---

## Question 6: ChatForm.tsx — Submission Flow

**File:** `client/src/components/Chat/Input/ChatForm.tsx`

### Key flow:
1. Form uses `react-hook-form` via `useChatFormContext()` (methods)
2. Text input registered as `methods.register('text', ...)`
3. On submit: `methods.handleSubmit(submitMessage)` (line 176)
4. `submitMessage` comes from `useSubmitMessage()` hook (line 128)
5. Files come from `useChatContext()` → `{ files, setFiles, filesLoading }`
6. The send button is disabled when `filesLoading || isSubmitting || disableInputs`

### Important for inline transcription
The submission flow is separate from the transcription flow. Currently, transcription auto-fires on upload (before any message is sent). To make transcription happen on send:
- Option A: Intercept `submitMessage` to also trigger transcription for pending audio files
- Option B: Add a separate "Transcribe" button in the inline controls that calls `startQueuedTranscription` directly

---

## Question 7: StartAudioTranscriptionRequest Type

**File:** `packages/data-provider/src/types/files.ts` (line 176-194)

```typescript
export type StartAudioTranscriptionRequest = {
  file_id: string;
  conversationId?: string;
  endpoint?: string;
  endpointType?: string;
  model?: string;
  agent_id?: string;
  assistant_id?: string;
  spec?: string;
  iconURL?: string;
  language?: string;
  transcriptionModel?: string;
  prompt?: string;
  speakerReferences?: {
    id?: string;
    name: string;
    file_id: string;
  }[];
};
```

### Response type (line 196-200):
```typescript
export type StartAudioTranscriptionResponse = {
  conversation: TConversation;
  messages: TMessage[];
  responseMessageId: string;
};
```

### API endpoint
`POST /api/files/transcribe` via `dataService.startAudioTranscription(payload)`

---

## Question 8: Recoil Atoms for Transcription

**File:** `client/src/store/settings.ts` (line 62-63)

```typescript
transcriptionModel: atomWithLocalStorage('transcriptionModel', ''),
transcriptionPrompt: atomWithLocalStorage('transcriptionPrompt', ''),
```

These are **global/default** settings stored in localStorage. They serve as fallbacks:

**Usage in useFileHandling.ts (line 129-130, 275-278):**
```typescript
const globalTranscriptionModel = useRecoilValue<string>(store.transcriptionModel);
const globalTranscriptionPrompt = useRecoilValue<string>(store.transcriptionPrompt);

// Priority: conversation-level > global > undefined
const effectiveTranscriptionModel =
  conversation?.transcriptionModel || globalTranscriptionModel || undefined;
const effectiveTranscriptionPrompt =
  conversation?.transcriptionPrompt?.trim() || globalTranscriptionPrompt?.trim() || undefined;
```

**Precedence chain:** conversation field → global Recoil atom (localStorage) → undefined (server default).

---

## Question 9: Conversation-Level Transcription Fields

### Schema (packages/data-provider/src/schemas.ts, line 709-720, 802-804)

```typescript
// Speaker reference schema
export const tTranscriptionSpeakerReferenceSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  file_id: z.string(),
  filename: z.string().optional(),
  filepath: z.string().optional(),
  type: z.string().optional(),
  bytes: coerceNumber.optional(),
  durationSeconds: coerceNumber.nullable().optional(),
  embedded: z.boolean().optional(),
  source: z.string().optional(),
});

// On the conversation schema (line 802-804):
transcriptionModel: z.string().nullable().optional(),
transcriptionPrompt: z.string().nullable().optional(),
transcriptionSpeakerReferences: z.array(tTranscriptionSpeakerReferenceSchema).optional(),
```

### TConversation type (line 931-934)
```typescript
export type TConversation = z.infer<typeof tConversationSchema> & {
  presetOverride?: Partial<TPreset>;
  disableParams?: boolean;
};
```

### Config exclusion list (config.ts line 59-61)
These fields are in `conversationExcludeFields`:
```typescript
'transcriptionModel',
'transcriptionPrompt',
'transcriptionSpeakerReferences',
```
This means they are excluded from certain conversation-level operations (likely preset serialization).

---

## Question 10: createAudioTranscriptionRequest (Server)

**File:** `api/server/services/Files/Audio/transcriptionQueue.js` (line 516-648)

### Parameters accepted (from `req.body`):
- `file_id` (required)
- `endpoint`, `endpointType`, `model`
- `transcriptionModel`
- `prompt`
- `speakerReferences` (array of `{ id, name, file_id }`)
- `language`
- `conversationId` (optional, for re-transcription)

### What it does:
1. Validates file exists and is transcribable (line 519-540)
2. Checks for existing transcription response (dedup) (line 542-545)
3. Normalizes conversation fields via `normalizeConversationFields()` (line 548)
4. Creates a new conversation with `crypto.randomUUID()` (line 549)
5. Saves a request message (user) with `metadata.type = 'audio_transcription'` (line 556-570)
6. Saves a response message (pending) with `unfinished: true` (line 572-586)
7. Saves conversation state (line 588-597)
8. Updates file metadata with transcription queue info (line 599-636):
   - `status: 'queued'`
   - `transcriptionModel`, `prompt`, `speakerReferences`
   - `requestMessageId`, `responseMessageId`, `conversationId`
9. Kicks the transcription runner (line 638)
10. Returns `{ conversation, messages, responseMessageId }` (line 640-645)

---

## Architectural Recommendation: Inline Transcription UI

### Component insertion strategy

```
ChatForm.tsx
  └─ div.rounded-3xl.border (compose box)
     ├─ <TextareaHeader>
     ├─ <EditBadges>
     ├─ <FileFormChat>           ← Existing file previews
     ├─ <AudioTranscriptionBar>  ← ★ NEW COMPONENT (insert here)
     ├─ <TextareaAutosize>
     └─ Bottom toolbar
```

### New component: `AudioTranscriptionBar`

**Location:** `client/src/components/Chat/Input/Files/AudioTranscriptionBar.tsx`

**Visibility condition:** Renders when `files` map contains at least one file where `isTranscribableMediaUpload({ filename, type })` is true.

**State management:** Uses conversation-level fields (`conversation.transcriptionModel`, `conversation.transcriptionPrompt`, `conversation.transcriptionSpeakerReferences`) via the same `setOption` pattern used by `TranscriptionSettings.tsx`.

**UI elements (compact inline layout):**
1. **Model selector** — Compact dropdown, reuse `transcriptionModelOptions` from `transcriptionModels.ts`
2. **Prompt input** — Collapsible text field (hidden by default, expand on click)
3. **Speaker samples** — Only shown when diarize model selected, mini-upload slots
4. **"Transcribe" button** — Calls `startQueuedTranscription` for pending audio files

### Changes required to disable auto-transcription:

**In `useFileHandling.ts` (line 398-406):**
Add a flag to suppress auto-trigger. Options:
- **Option A:** Check a new Recoil atom `store.manualTranscriptionMode` (user preference)
- **Option B:** Always set `shouldAutoTranscribe = false` and rely on explicit "Transcribe" button
- **Option C:** Check if any transcription controls are visible (audio file detected in files map)

The simplest approach is Option B: remove the auto-transcription entirely and let the inline UI handle it. The audio file stays in the `FileRow` preview, and the user clicks "Transcribe" when ready.

### Data flow summary:
```
User uploads audio → file appears in FileRow (no auto-transcription)
  → AudioTranscriptionBar appears with controls
  → User picks model, sets prompt, optionally adds speaker clips
  → User clicks "Transcribe" (or Send with message)
  → calls startQueuedTranscription() with conversation-level settings
  → POST /api/files/transcribe
  → polling begins, file preview removed, transcription appears in chat
```
