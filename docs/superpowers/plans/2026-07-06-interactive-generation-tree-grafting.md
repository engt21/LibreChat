# Interactive Generation Tree Grafting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-safe, fully interactive conversation-tree workspace that copies and grafts complete or stable incomplete generations and subtrees beneath another generation, preserves source history and tool/file references, and supports immediate guarded undo.

**Architecture:** Keep LibreChat's one-parent message-tree invariant. The backend inserts a synthetic user-role bridge and topologically cloned messages, records provenance in existing mixed message metadata, clones persisted ToolCall rows, and uses revision/idempotency/ownership/size/active-stream guards. The client derives a deterministic graph from the existing message cache, renders it with SVG edges and HTML nodes inside the already-installed `react-zoom-pan-pinch`, and coordinates source/destination selection, server preview, cross-provider stream stabilization, creation, focus, and undo through one chat-level provider.

**Tech Stack:** Express 5, Mongoose, Redis-compatible LibreChat caches, Jest 30, React 18, TypeScript, TanStack Query 4, Radix dialogs/toasts, Tailwind, `react-zoom-pan-pinch`, Playwright.

---

## File Map

### Shared API contract

- Modify `packages/data-provider/src/types.ts` — graft lifecycle, request, response, metadata, and undo types.
- Modify `packages/data-provider/src/api-endpoints.ts` — preview, create, inspect, and undo URLs.
- Modify `packages/data-provider/src/data-service.ts` — typed HTTP calls.
- Create `packages/data-provider/src/generationGrafts.spec.ts` — endpoint and service contract tests.

### Backend

- Create `api/server/services/MessageGrafts/constants.js` — fixed bridge copy, limits, and error codes.
- Create `api/server/services/MessageGrafts/active.js` — canonical active-generation resolution across resumable jobs and Assistants.
- Create `api/server/services/MessageGrafts/graph.js` — indexing, lifecycle classification, descendants, ancestors, overlap, and active-leaf logic.
- Create `api/server/services/MessageGrafts/revision.js` — deterministic tree revision.
- Create `api/server/services/MessageGrafts/clone.js` — message, attachment, nested graft metadata, and ToolCall cloning.
- Create `api/server/services/MessageGrafts/index.js` — preview, create, inspect, undo, idempotency, locking, and cleanup orchestration.
- Create `api/server/services/MessageGrafts/*.spec.js` — focused unit tests for each module.
- Create `api/server/middleware/limiters/graftLimiters.js` — separate preview and mutation limits.
- Modify `api/server/middleware/limiters/index.js` — export graft limiters.
- Modify `api/server/routes/messages.js` — four graft routes before generic message routes.
- Create `api/server/routes/__tests__/messages-grafts.spec.js` — route status and payload tests.
- Modify `api/server/controllers/assistants/chatV1.js` — persist response message ID in active-run cache and clear after final persistence.
- Modify `api/server/controllers/assistants/chatV2.js` — same active-run lifecycle contract.
- Modify `api/server/middleware/abortRun.js` — retain the settling marker until partial messages are persisted, then clear it.
- Create `api/server/services/MessageGrafts/active.spec.js` — Assistants and resumable job status tests.

### Client data and notification infrastructure

- Modify `client/src/data-provider/SSE/mutations.ts` — provider-aware stop request used by graft stabilization.
- Modify `client/src/hooks/Chat/useChatHelpers.ts` — make `stopGenerating()` await real Assistants cancellation and message reconciliation.
- Create `client/src/data-provider/Messages/generationGrafts.ts` — preview/create/details/undo hooks and cache updates.
- Modify `client/src/data-provider/Messages/index.ts` — export graft hooks.
- Modify `client/src/data-provider/SSE/queries.ts` — optional active-status polling interval.
- Modify `packages/client/src/common/types.ts` and `client/src/common/types.ts` — optional toast action contract.
- Modify `packages/client/src/store.ts` — toast action state.
- Modify `packages/client/src/hooks/useToast.ts` — action lifecycle and timeout cleanup.
- Modify `packages/client/src/Providers/ToastContext.tsx` — widened `showToast` contract.
- Modify `packages/client/src/components/Toast.tsx` — accessible action button.
- Create `packages/client/src/components/Toast.spec.tsx` — action and dismissal tests.

### Client tree workspace

- Create `client/src/components/Chat/Tree/types.ts` — normalized graph and view-state types.
- Create `client/src/components/Chat/Tree/graph.ts` — normalization, search, valid-target, counts, and semantic detail helpers.
- Create `client/src/components/Chat/Tree/layout.ts` — deterministic left-to-right and top-to-bottom layout.
- Create `client/src/components/Chat/Tree/storage.ts` — per-conversation collapse/orientation persistence.
- Create `client/src/components/Chat/Tree/*.spec.ts` — pure graph/layout/storage tests.
- Create `client/src/Providers/GenerationTreeContext.tsx` — shared dialog/open/focus/graft-mode state.
- Modify `client/src/Providers/index.ts` — export generation-tree provider and hook.
- Modify `client/src/components/Chat/Presentation.tsx` — mount one provider/dialog per chat.
- Create `client/src/components/SidePanel/Tree/ConversationTreePanel.tsx` — side-panel entry point.
- Create `client/src/components/SidePanel/Tree/index.ts` — export panel.
- Modify `client/src/hooks/Nav/useSideNavLinks.ts` — add Conversation Tree link.
- Create `client/src/components/Chat/Tree/ConversationTreeDialog.tsx` — full-screen responsive shell.
- Create `client/src/components/Chat/Tree/ConversationTreeToolbar.tsx` — zoom, fit, orientation, search, expand/collapse, help.
- Create `client/src/components/Chat/Tree/ConversationTreeCanvas.tsx` — transformed graph viewport and SVG edges.
- Create `client/src/components/Chat/Tree/ConversationTreeNode.tsx` — semantic zoom node, graft handle, badges, keyboard navigation.
- Create `client/src/components/Chat/Tree/ConversationTreeMiniMap.tsx` — viewport navigation.
- Create `client/src/components/Chat/Tree/ConversationTreeList.tsx` — synchronized accessible tree alternative.
- Create `client/src/components/Chat/Tree/ConversationTreeInspector.tsx` — source/destination, copy mode, preview, warnings, create, and undo.
- Create `client/src/components/Chat/Tree/useGenerationTreeDrag.ts` — pointer drag/drop, target detection, auto-pan, and auto-expand.
- Create `client/src/components/Chat/Tree/useGenerationGraft.ts` — preview/create/stabilize/wait/undo state machine.
- Create `client/src/components/Chat/Tree/GenerationTreeActions.tsx` — assistant-message “View in tree” and “Graft generation” controls.
- Modify `client/src/components/Chat/Messages/HoverButtons.tsx` — mount tree actions beside Fork.
- Create `client/src/components/Chat/Tree/GraftBridgeCard.tsx` — transcript provenance and undo.
- Modify `client/src/components/Chat/Messages/Content/MessageContent.tsx` — compact bridge rendering for text messages.
- Modify `client/src/components/Chat/Messages/MessageParts.tsx` — compact bridge rendering for structured messages.
- Modify `client/src/components/Chat/Messages/ui/MessageRender.tsx` — suppress normal user heading/avatar for bridge cards.
- Create `client/src/components/Chat/Tree/__tests__/*.spec.tsx` — dialog, drag/drop, stabilization, bridge, and undo tests.
- Modify `client/src/locales/en/translation.json` — all visible labels, descriptions, warnings, and announcements.

### Browser validation, docs, and preservation

- Create `e2e/specs/generation-tree-grafting.spec.ts` — synthetic complete/partial matrix, drag/drop, keyboard, mobile, and undo flow.
- Create `local-services/verify-generation-tree-grafting.sh` — source/deployed-runtime preservation verifier.
- Create `GENERATION_TREE_GRAFTING.md` — user, operator, limits, lifecycle, and recovery guide.
- Modify `CUSTOMIZATION_MASTER_DOC.md` — canonical implementation and RCA notes.
- Modify `CUSTOMIZATION_MASTER_GUIDE.md` — protected files and merge checks.

---

### Task 1: Define the Shared Graft Contract

**Files:**
- Modify: `packages/data-provider/src/types.ts:360-430`
- Modify: `packages/data-provider/src/api-endpoints.ts:120-150`
- Modify: `packages/data-provider/src/data-service.ts:860-990`
- Create: `packages/data-provider/src/generationGrafts.spec.ts`

- [ ] **Step 1: Write the failing endpoint and request-shape tests**

```ts
import * as endpoints from './api-endpoints';

describe('generation graft API contract', () => {
  it('builds preview, create, inspect, and undo endpoints', () => {
    expect(endpoints.generationGraftPreview('convo-1')).toBe(
      '/api/messages/convo-1/grafts/preview',
    );
    expect(endpoints.generationGrafts('convo-1')).toBe('/api/messages/convo-1/grafts');
    expect(endpoints.generationGraft('convo-1', 'graft-1')).toBe(
      '/api/messages/convo-1/grafts/graft-1',
    );
  });
});
```

- [ ] **Step 2: Run the data-provider test and verify it fails**

Run:

```bash
cd packages/data-provider
npx jest --runInBand --testPathPatterns=generationGrafts.spec.ts
```

Expected: FAIL because `generationGraftPreview`, `generationGrafts`, and `generationGraft` are not exported.

- [ ] **Step 3: Add exact graft types**

Add these exported contracts to `packages/data-provider/src/types.ts`:

```ts
export type TGenerationGraftStableState =
  | 'complete'
  | 'stopped_partial'
  | 'aborted_partial'
  | 'errored_partial';

export type TGenerationGraftLifecycleState = TGenerationGraftStableState | 'streaming';
export type TGenerationGraftMode = 'generation' | 'subtree';

export type TGenerationGraftSelection = {
  sourceMessageId: string;
  destinationMessageId: string;
  mode: TGenerationGraftMode;
  sourceActiveLeafMessageId?: string;
};

export type TGenerationGraftCounts = {
  messages: number;
  toolCalls: number;
  files: number;
  images: number;
  approximateTokens: number;
};

export type TGenerationGraftPreviewRequest = TGenerationGraftSelection & {
  expectedTreeRevision?: string;
};

export type TGenerationGraftPreviewResponse = TGenerationGraftSelection & {
  conversationId: string;
  sourceState: TGenerationGraftLifecycleState;
  destinationState: TGenerationGraftLifecycleState;
  copiedMessageIds: string[];
  activeSourceLeafMessageId: string;
  destinationChildCount: number;
  counts: TGenerationGraftCounts;
  warnings: string[];
  treeRevision: string;
  requiresStabilization: boolean;
  activeMessageIds: string[];
  conversationActiveWithoutMessageId: boolean;
  canCreate: boolean;
};

export type TGenerationGraftCreateRequest = TGenerationGraftSelection & {
  idempotencyKey: string;
  expectedTreeRevision: string;
};

export type TGenerationGraftCreateResponse = {
  graftId: string;
  bridgeMessageId: string;
  copiedRootMessageId: string;
  activeCopiedMessageId: string;
  copiedMessageCount: number;
  createdMessages: TMessage[];
};

export type TGenerationGraftDetailsResponse = {
  graftId: string;
  bridgeMessageId: string;
  copiedMessageIds: string[];
  continuationMessageIds: string[];
  copiedCounts: TGenerationGraftCounts;
  continuationCounts: TGenerationGraftCounts;
  canUndoWithoutContinuations: boolean;
};

export type TGenerationGraftUndoRequest = {
  includeContinuations?: boolean;
};

export type TGenerationGraftUndoResponse = {
  graftId: string;
  deletedMessageIds: string[];
  deletedCount: number;
};

export type TGenerationGraftMetadata = {
  kind: 'generation_graft';
  graftId: string;
  idempotencyKey: string;
  sourceConversationId: string;
  sourceRootMessageId: string;
  sourceMessageIds: string[];
  destinationMessageId: string;
  copiedRootMessageId: string;
  copiedMessageIds: string[];
  activeCopiedMessageId: string;
  mode: TGenerationGraftMode;
  sourceState: TGenerationGraftStableState;
  destinationState: TGenerationGraftStableState;
  createdAt: string;
};

export type TGenerationGraftCopyMetadata = {
  kind: 'generation_graft_copy';
  graftId: string;
  clonedFromMessageId: string;
};

export type TGenerationGraftErrorCode =
  | 'MESSAGE_NOT_FOUND'
  | 'INVALID_SOURCE'
  | 'INVALID_DESTINATION'
  | 'OVERLAPPING_BRANCHES'
  | 'GRAFT_REQUIRES_STABILIZATION'
  | 'TREE_CHANGED'
  | 'GRAFT_HAS_CONTINUATIONS'
  | 'GRAFT_TOO_LARGE'
  | 'GRAFT_BUSY';

export type TGenerationGraftErrorResponse = {
  error: string;
  code: TGenerationGraftErrorCode;
  activeMessageIds?: string[];
  conversationActiveWithoutMessageId?: boolean;
};
```

- [ ] **Step 4: Add endpoint and data-service functions**

Add to `packages/data-provider/src/api-endpoints.ts`:

```ts
export const generationGrafts = (conversationId: string) =>
  `${BASE_URL}/api/messages/${encodeURIComponent(conversationId)}/grafts`;

export const generationGraftPreview = (conversationId: string) =>
  `${generationGrafts(conversationId)}/preview`;

export const generationGraft = (conversationId: string, graftId: string) =>
  `${generationGrafts(conversationId)}/${encodeURIComponent(graftId)}`;
```

Add to `packages/data-provider/src/data-service.ts`:

```ts
export function previewGenerationGraft(
  conversationId: string,
  payload: t.TGenerationGraftPreviewRequest,
): Promise<t.TGenerationGraftPreviewResponse> {
  return request.post(endpoints.generationGraftPreview(conversationId), payload);
}

export function createGenerationGraft(
  conversationId: string,
  payload: t.TGenerationGraftCreateRequest,
): Promise<t.TGenerationGraftCreateResponse> {
  return request.post(endpoints.generationGrafts(conversationId), payload);
}

export function getGenerationGraft(
  conversationId: string,
  graftId: string,
): Promise<t.TGenerationGraftDetailsResponse> {
  return request.get(endpoints.generationGraft(conversationId, graftId));
}

export function undoGenerationGraft(
  conversationId: string,
  graftId: string,
  payload: t.TGenerationGraftUndoRequest,
): Promise<t.TGenerationGraftUndoResponse> {
  return request.deleteWithOptions(endpoints.generationGraft(conversationId, graftId), {
    data: payload,
  });
}
```

- [ ] **Step 5: Run tests and build the data-provider**

Run:

```bash
cd packages/data-provider
npx jest --runInBand --testPathPatterns=generationGrafts.spec.ts
cd ../..
npm run build:data-provider
```

Expected: test PASS and `packages/data-provider/dist` builds successfully.

- [ ] **Step 6: Commit**

```bash
git add packages/data-provider/src/types.ts \
  packages/data-provider/src/api-endpoints.ts \
  packages/data-provider/src/data-service.ts \
  packages/data-provider/src/generationGrafts.spec.ts
git commit -m "feat: define generation graft API contract"
```

### Task 2: Make Active-Generation Status Cross-Provider

**Files:**
- Create: `api/server/services/MessageGrafts/active.js`
- Create: `api/server/services/MessageGrafts/active.spec.js`
- Modify: `api/server/controllers/assistants/chatV1.js`
- Modify: `api/server/controllers/assistants/chatV2.js`
- Modify: `api/server/middleware/abortRun.js`

- [ ] **Step 1: Write failing active-state tests**

```js
const { getActiveGenerationState, encodeAssistantRunValue } = require('./active');

describe('MessageGrafts active generation resolver', () => {
  it('returns the resumable response message for a running owned job', async () => {
    const state = await getActiveGenerationState({
      userId: 'user-1',
      conversationId: 'convo-1',
      generationJobManager: {
        getJob: jest.fn().mockResolvedValue({
          userId: 'user-1',
          status: 'running',
          responseMessageId: 'assistant-live',
        }),
      },
      getLogStores: jest.fn(),
    });

    expect(state).toEqual({
      active: true,
      provider: 'resumable',
      responseMessageId: 'assistant-live',
    });
  });

  it('reads Assistants response IDs from the abort registry', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue(
        encodeAssistantRunValue('thread-1', 'run-1', 'assistant-live'),
      ),
    };
    const state = await getActiveGenerationState({
      userId: 'user-1',
      conversationId: 'convo-1',
      generationJobManager: { getJob: jest.fn().mockResolvedValue(null) },
      getLogStores: jest.fn(() => cache),
    });

    expect(state).toEqual({
      active: true,
      provider: 'assistants',
      responseMessageId: 'assistant-live',
    });
  });

  it('treats cancelled Assistants runs as settling until the cache is deleted', async () => {
    const cache = { get: jest.fn().mockResolvedValue('cancelled') };
    const state = await getActiveGenerationState({
      userId: 'user-1',
      conversationId: 'convo-1',
      generationJobManager: { getJob: jest.fn().mockResolvedValue(null) },
      getLogStores: jest.fn(() => cache),
    });

    expect(state).toEqual({
      active: true,
      provider: 'assistants',
      responseMessageId: null,
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd api
npx jest --runInBand --testPathPatterns=server/services/MessageGrafts/active.spec.js
```

Expected: FAIL because `active.js` does not exist.

- [ ] **Step 3: Implement the resolver**

Create `api/server/services/MessageGrafts/active.js`:

```js
const { GenerationJobManager } = require('@librechat/api');
const { CacheKeys } = require('librechat-data-provider');
const getLogStores = require('~/cache/getLogStores');

function encodeAssistantRunValue(threadId, runId, responseMessageId) {
  return [threadId, runId, responseMessageId].filter(Boolean).join(':');
}

function parseAssistantRunValue(value) {
  if (!value) {
    return null;
  }
  if (value === 'cancelled') {
    return { threadId: null, runId: null, responseMessageId: null, settling: true };
  }
  const [threadId, runId, responseMessageId] = value.split(':');
  return {
    threadId: threadId || null,
    runId: runId || null,
    responseMessageId: responseMessageId || null,
    settling: false,
  };
}

async function getActiveGenerationState({
  userId,
  conversationId,
  generationJobManager = GenerationJobManager,
  getLogStores: getStores = getLogStores,
}) {
  const job = await generationJobManager.getJob(conversationId);
  if (job?.status === 'running' && (!job.userId || job.userId === userId)) {
    return {
      active: true,
      provider: 'resumable',
      responseMessageId: job.responseMessageId ?? null,
    };
  }

  const cache = getStores(CacheKeys.ABORT_KEYS);
  const run = parseAssistantRunValue(await cache.get(`${userId}:${conversationId}`));
  if (run) {
    return {
      active: true,
      provider: 'assistants',
      responseMessageId: run.responseMessageId,
    };
  }

  return { active: false, provider: null, responseMessageId: null };
}

module.exports = {
  encodeAssistantRunValue,
  parseAssistantRunValue,
  getActiveGenerationState,
};
```

- [ ] **Step 4: Update Assistants cache writes and completion cleanup**

In both `api/server/controllers/assistants/chatV1.js` and `api/server/controllers/assistants/chatV2.js`, replace active-run writes with:

```js
const {
  encodeAssistantRunValue,
} = require('~/server/services/MessageGrafts/active');

await cache.set(
  cacheKey,
  encodeAssistantRunValue(thread_id, run_id, responseMessageId),
  Time.TEN_MINUTES,
);
```

After the final assistant message is successfully persisted, clear the active marker:

```js
await saveAssistantMessage(req, { ...responseMessage, model });
await cache.delete(cacheKey);
```

In `api/server/middleware/abortRun.js`, retain `cancelled` during provider cancellation and message reconciliation, then clear only after `checkMessageGaps` returns:

```js
runMessages = await checkMessageGaps({
  openai,
  run_id,
  endpoint,
  thread_id,
  conversationId,
  latestMessageId,
});
await cache.delete(cacheKey);
```

- [ ] **Step 5: Run active-state and existing abort tests**

Run:

```bash
cd api
npx jest --runInBand \
  --testPathPatterns=server/services/MessageGrafts/active.spec.js \
  --testPathPatterns=server/routes/agents/__tests__/abort.spec.js \
  --testPathPatterns=server/middleware/abortMiddleware.spec.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add api/server/services/MessageGrafts/active.js \
  api/server/services/MessageGrafts/active.spec.js \
  api/server/controllers/assistants/chatV1.js \
  api/server/controllers/assistants/chatV2.js \
  api/server/middleware/abortRun.js
git commit -m "fix: track active generations across providers"
```

### Task 3: Build Graph, Lifecycle, and Revision Primitives

**Files:**
- Create: `api/server/services/MessageGrafts/constants.js`
- Create: `api/server/services/MessageGrafts/graph.js`
- Create: `api/server/services/MessageGrafts/graph.spec.js`
- Create: `api/server/services/MessageGrafts/revision.js`
- Create: `api/server/services/MessageGrafts/revision.spec.js`

- [ ] **Step 1: Write failing lifecycle and graph tests**

```js
const {
  buildMessageGraph,
  classifyLifecycle,
  collectDescendantIds,
  validateSelection,
} = require('./graph');

const messages = [
  {
    messageId: 'prompt',
    parentMessageId: '00000000-0000-0000-0000-000000000000',
    isCreatedByUser: true,
  },
  { messageId: 'a', parentMessageId: 'prompt', isCreatedByUser: false },
  { messageId: 'b', parentMessageId: 'prompt', isCreatedByUser: false, unfinished: true },
  { messageId: 'b-user', parentMessageId: 'b', isCreatedByUser: true },
  { messageId: 'b-child', parentMessageId: 'b-user', isCreatedByUser: false, error: true },
];

describe('MessageGrafts graph', () => {
  it('accepts complete-to-partial and partial-to-partial sibling selections', () => {
    const graph = buildMessageGraph(messages);
    expect(validateSelection(graph, 'a', 'b')).toEqual({
      source: expect.objectContaining({ messageId: 'a' }),
      destination: expect.objectContaining({ messageId: 'b' }),
    });
    expect(validateSelection(graph, 'b', 'a')).toBeTruthy();
  });

  it('rejects ancestor or descendant destinations', () => {
    const graph = buildMessageGraph(messages);
    expect(() => validateSelection(graph, 'b', 'b-child')).toThrow(
      expect.objectContaining({ code: 'OVERLAPPING_BRANCHES' }),
    );
  });

  it('classifies stable partial states separately from active streaming', () => {
    expect(classifyLifecycle(messages[2], { active: false })).toBe('stopped_partial');
    expect(classifyLifecycle(messages[4], { active: false })).toBe('errored_partial');
    expect(classifyLifecycle(messages[2], { active: true, responseMessageId: 'b' })).toBe(
      'streaming',
    );
  });

  it('collects a complete subtree in parent-first order', () => {
    const graph = buildMessageGraph(messages);
    expect(collectDescendantIds(graph, 'b')).toEqual(['b', 'b-user', 'b-child']);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd api
npx jest --runInBand \
  --testPathPatterns=server/services/MessageGrafts/graph.spec.js \
  --testPathPatterns=server/services/MessageGrafts/revision.spec.js
```

Expected: FAIL because graph and revision modules do not exist.

- [ ] **Step 3: Add fixed constants and typed errors**

Create `api/server/services/MessageGrafts/constants.js`:

```js
const GRAFT_BRIDGE_TEXT =
  'An alternate completed assistant generation was grafted into this branch. ' +
  'Treat the following assistant message and any copied continuation as prior conversation context.';

const PARTIAL_GRAFT_WARNING =
  'One or both grafted generations are incomplete. Treat their content as partial prior context ' +
  'and do not assume that either represents a finished answer.';

const MAX_GRAFT_MESSAGES = Number.parseInt(process.env.GRAFT_MAX_MESSAGES, 10) || 250;
const MAX_GRAFT_PAYLOAD_BYTES =
  Number.parseInt(process.env.GRAFT_MAX_PAYLOAD_BYTES, 10) || 8 * 1024 * 1024;

class GenerationGraftError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'GenerationGraftError';
    this.code = code;
    this.statusCode = statusCode;
    Object.assign(this, details);
  }
}

module.exports = {
  GRAFT_BRIDGE_TEXT,
  PARTIAL_GRAFT_WARNING,
  MAX_GRAFT_MESSAGES,
  MAX_GRAFT_PAYLOAD_BYTES,
  GenerationGraftError,
};
```

- [ ] **Step 4: Implement graph and lifecycle helpers**

Create `api/server/services/MessageGrafts/graph.js` with these exports and behavior:

```js
const { Constants } = require('librechat-data-provider');
const { GenerationGraftError } = require('./constants');

function buildMessageGraph(messages) {
  const byId = new Map();
  const childrenByParent = new Map();
  for (const message of messages) {
    if (!message?.messageId || byId.has(message.messageId)) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        'Conversation contains duplicate or missing message IDs.',
      );
    }
    byId.set(message.messageId, message);
    const parentId = message.parentMessageId ?? Constants.NO_PARENT;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(message.messageId);
    childrenByParent.set(parentId, children);
  }
  return { messages, byId, childrenByParent };
}

function collectDescendantIds(graph, rootId) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (messageId) => {
    if (visiting.has(messageId)) {
      throw new GenerationGraftError('INVALID_SOURCE', 'Conversation contains a cycle.');
    }
    if (visited.has(messageId)) {
      return;
    }
    visiting.add(messageId);
    ordered.push(messageId);
    for (const childId of graph.childrenByParent.get(messageId) ?? []) {
      visit(childId);
    }
    visiting.delete(messageId);
    visited.add(messageId);
  };
  visit(rootId);
  return ordered;
}

function collectAncestorIds(graph, messageId) {
  const ancestors = [];
  const visited = new Set();
  let current = graph.byId.get(messageId);
  while (current?.parentMessageId && current.parentMessageId !== Constants.NO_PARENT) {
    if (visited.has(current.parentMessageId)) {
      throw new GenerationGraftError('INVALID_SOURCE', 'Conversation contains a cycle.');
    }
    visited.add(current.parentMessageId);
    ancestors.push(current.parentMessageId);
    current = graph.byId.get(current.parentMessageId);
  }
  return ancestors;
}

function classifyLifecycle(message, activeState) {
  if (
    activeState?.active &&
    (activeState.responseMessageId == null || activeState.responseMessageId === message.messageId)
  ) {
    return 'streaming';
  }
  if (message.error === true) {
    return 'errored_partial';
  }
  if (message.unfinished === true) {
    const reason = String(
      message.metadata?.generationTermination ?? message.finish_reason ?? '',
    ).toLowerCase();
    return ['abort', 'aborted', 'cancelled', 'canceled'].includes(reason)
      ? 'aborted_partial'
      : 'stopped_partial';
  }
  return 'complete';
}

function validateSelection(graph, sourceMessageId, destinationMessageId) {
  const source = graph.byId.get(sourceMessageId);
  const destination = graph.byId.get(destinationMessageId);
  if (!source || !destination) {
    throw new GenerationGraftError('MESSAGE_NOT_FOUND', 'Selected message was not found.', 404);
  }
  if (source.isCreatedByUser !== false) {
    throw new GenerationGraftError('INVALID_SOURCE', 'Source must be an assistant generation.');
  }
  if (destination.isCreatedByUser !== false) {
    throw new GenerationGraftError(
      'INVALID_DESTINATION',
      'Destination must be an assistant generation.',
    );
  }
  if (sourceMessageId === destinationMessageId) {
    throw new GenerationGraftError(
      'INVALID_DESTINATION',
      'Source and destination must be different.',
    );
  }
  const sourceDescendants = new Set(collectDescendantIds(graph, sourceMessageId));
  const sourceAncestors = new Set(collectAncestorIds(graph, sourceMessageId));
  if (sourceDescendants.has(destinationMessageId) || sourceAncestors.has(destinationMessageId)) {
    throw new GenerationGraftError(
      'OVERLAPPING_BRANCHES',
      'Source and destination cannot be ancestors or descendants of each other.',
    );
  }
  return { source, destination };
}

module.exports = {
  buildMessageGraph,
  collectDescendantIds,
  collectAncestorIds,
  classifyLifecycle,
  validateSelection,
};
```

- [ ] **Step 5: Implement deterministic revision hashing**

Create `api/server/services/MessageGrafts/revision.js`:

```js
const crypto = require('crypto');

function computeTreeRevision(messages, activeState) {
  const rows = messages
    .map((message) => ({
      messageId: message.messageId,
      parentMessageId: message.parentMessageId ?? null,
      unfinished: message.unfinished === true,
      error: message.error === true,
      finishReason: message.finish_reason ?? null,
      updatedAt: message.updatedAt ? new Date(message.updatedAt).toISOString() : null,
    }))
    .sort((left, right) => left.messageId.localeCompare(right.messageId));

  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        rows,
        active: activeState?.active === true,
        activeMessageId: activeState?.responseMessageId ?? null,
      }),
    )
    .digest('hex');
}

module.exports = { computeTreeRevision };
```

- [ ] **Step 6: Run tests**

Run:

```bash
cd api
npx jest --runInBand \
  --testPathPatterns=server/services/MessageGrafts/graph.spec.js \
  --testPathPatterns=server/services/MessageGrafts/revision.spec.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/server/services/MessageGrafts/constants.js \
  api/server/services/MessageGrafts/graph.js \
  api/server/services/MessageGrafts/graph.spec.js \
  api/server/services/MessageGrafts/revision.js \
  api/server/services/MessageGrafts/revision.spec.js
git commit -m "feat: add generation graft graph primitives"
```

### Task 4: Clone Messages, Attachments, Nested Grafts, and ToolCalls

**Files:**
- Create: `api/server/services/MessageGrafts/clone.js`
- Create: `api/server/services/MessageGrafts/clone.spec.js`

- [ ] **Step 1: Write failing clone tests**

```js
const { buildClonePlan } = require('./clone');

describe('MessageGrafts clone plan', () => {
  it('remaps parents and embedded attachment message IDs without changing shared file IDs', () => {
    const plan = buildClonePlan({
      messages: [
        {
          messageId: 'assistant-1',
          parentMessageId: 'prompt-1',
          isCreatedByUser: false,
          files: [{ file_id: 'file-1', messageId: 'assistant-1' }],
          attachments: [{ messageId: 'assistant-1', filepath: '/images/shared.png' }],
        },
      ],
      toolCalls: [
        {
          messageId: 'assistant-1',
          toolId: 'python',
          attachments: [{ messageId: 'assistant-1', file_id: 'file-1' }],
        },
      ],
      destinationMessageId: 'assistant-destination',
      userId: 'user-1',
      conversationId: 'convo-1',
      graftId: 'graft-1',
      idempotencyKey: 'idempotency-1',
      sourceState: 'complete',
      destinationState: 'complete',
      mode: 'generation',
      activeSourceLeafMessageId: 'assistant-1',
      uuid: jest
        .fn()
        .mockReturnValueOnce('bridge-1')
        .mockReturnValueOnce('assistant-copy-1'),
      now: new Date('2026-07-06T12:00:00.000Z'),
    });

    expect(plan.messages[0]).toMatchObject({
      messageId: 'bridge-1',
      parentMessageId: 'assistant-destination',
      isCreatedByUser: true,
    });
    expect(plan.messages[1]).toMatchObject({
      messageId: 'assistant-copy-1',
      parentMessageId: 'bridge-1',
      files: [{ file_id: 'file-1', messageId: 'assistant-copy-1' }],
      attachments: [{ messageId: 'assistant-copy-1', filepath: '/images/shared.png' }],
    });
    expect(plan.toolCalls[0]).toMatchObject({
      messageId: 'assistant-copy-1',
      attachments: [{ messageId: 'assistant-copy-1', file_id: 'file-1' }],
    });
  });
});
```

- [ ] **Step 2: Run the clone test and verify failure**

Run:

```bash
cd api
npx jest --runInBand --testPathPatterns=server/services/MessageGrafts/clone.spec.js
```

Expected: FAIL because `clone.js` does not exist.

- [ ] **Step 3: Implement clone planning**

Create `api/server/services/MessageGrafts/clone.js` with:

```js
const { v4: uuidv4 } = require('uuid');
const { GRAFT_BRIDGE_TEXT, PARTIAL_GRAFT_WARNING } = require('./constants');

function stripMongoFields(record) {
  const { _id, __v, createdAt, updatedAt, user, ...clean } = record;
  return clean;
}

function remapEmbeddedMessageIds(value, idMap) {
  if (Array.isArray(value)) {
    return value.map((entry) => remapEmbeddedMessageIds(entry, idMap));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === 'messageId' && typeof entry === 'string' && idMap.has(entry)) {
        return [key, idMap.get(entry)];
      }
      return [key, remapEmbeddedMessageIds(entry, idMap)];
    }),
  );
}

function remapNestedGraftMetadata(metadata, idMap, uuid) {
  const nested = metadata?.generationGraft;
  if (!nested || nested.kind !== 'generation_graft') {
    return metadata;
  }
  const nestedGraftId = uuid();
  const remapOne = (messageId) => idMap.get(messageId) ?? messageId;
  return {
    ...metadata,
    generationGraft: {
      ...nested,
      graftId: nestedGraftId,
      idempotencyKey: `nested:${nestedGraftId}`,
      sourceMessageIds: nested.sourceMessageIds.map(remapOne),
      destinationMessageId: remapOne(nested.destinationMessageId),
      copiedRootMessageId: remapOne(nested.copiedRootMessageId),
      copiedMessageIds: nested.copiedMessageIds.map(remapOne),
      activeCopiedMessageId: remapOne(nested.activeCopiedMessageId),
    },
  };
}

function buildClonePlan({
  messages,
  toolCalls,
  destinationMessageId,
  userId,
  conversationId,
  graftId,
  idempotencyKey,
  sourceState,
  destinationState,
  mode,
  activeSourceLeafMessageId,
  uuid = uuidv4,
  now = new Date(),
}) {
  const bridgeMessageId = uuid();
  const idMap = new Map(messages.map((message) => [message.messageId, uuid()]));
  const sourceMessageIds = messages.map((message) => message.messageId);
  const copiedMessageIds = sourceMessageIds.map((messageId) => idMap.get(messageId));
  const partial = sourceState !== 'complete' || destinationState !== 'complete';
  const bridgeText = partial
    ? `${GRAFT_BRIDGE_TEXT}\n\n${PARTIAL_GRAFT_WARNING}`
    : GRAFT_BRIDGE_TEXT;
  const activeCopiedMessageId =
    idMap.get(activeSourceLeafMessageId) ?? idMap.get(messages[0].messageId);

  const bridge = {
    messageId: bridgeMessageId,
    conversationId,
    parentMessageId: destinationMessageId,
    sender: 'Graft',
    text: bridgeText,
    isCreatedByUser: true,
    unfinished: false,
    error: false,
    user: userId,
    createdAt: now,
    updatedAt: now,
    metadata: {
      generationGraft: {
        kind: 'generation_graft',
        graftId,
        idempotencyKey,
        sourceConversationId: conversationId,
        sourceRootMessageId: messages[0].messageId,
        sourceMessageIds,
        destinationMessageId,
        copiedRootMessageId: idMap.get(messages[0].messageId),
        copiedMessageIds,
        activeCopiedMessageId,
        mode,
        sourceState,
        destinationState,
        createdAt: now.toISOString(),
      },
    },
  };

  const clonedMessages = messages.map((message, index) => {
    const clean = stripMongoFields(message);
    const parentMessageId = idMap.get(message.parentMessageId) ?? bridgeMessageId;
    const metadata = remapNestedGraftMetadata(clean.metadata, idMap, uuid);
    const timestamp = new Date(now.getTime() + index + 1);
    return {
      ...clean,
      messageId: idMap.get(message.messageId),
      conversationId,
      parentMessageId,
      user: userId,
      files: remapEmbeddedMessageIds(clean.files, idMap),
      attachments: remapEmbeddedMessageIds(clean.attachments, idMap),
      content: remapEmbeddedMessageIds(clean.content, idMap),
      metadata: {
        ...metadata,
        generationGraftCopy: {
          kind: 'generation_graft_copy',
          graftId,
          clonedFromMessageId: message.messageId,
        },
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });

  const clonedToolCalls = toolCalls.map((toolCall) => {
    const clean = stripMongoFields(toolCall);
    return {
      ...clean,
      conversationId,
      messageId: idMap.get(toolCall.messageId),
      user: userId,
      attachments: remapEmbeddedMessageIds(clean.attachments, idMap),
    };
  });

  return {
    bridgeMessageId,
    copiedRootMessageId: idMap.get(messages[0].messageId),
    activeCopiedMessageId,
    copiedMessageIds,
    messages: [bridge, ...clonedMessages],
    toolCalls: clonedToolCalls,
  };
}

module.exports = {
  buildClonePlan,
  remapEmbeddedMessageIds,
  remapNestedGraftMetadata,
};
```

- [ ] **Step 4: Add tests for nested graft IDs, partial bridge text, and parent ordering**

The tests must assert:

```js
expect(plan.messages[0].metadata.generationGraft.sourceState).toBe('stopped_partial');
expect(plan.messages[0].text).toContain('incomplete');
expect(plan.messages.map((message) => message.parentMessageId)).toEqual([
  'destination',
  'bridge',
  'copy-parent',
]);
expect(
  plan.messages[2].metadata.generationGraft.graftId,
).not.toBe('original-nested-graft-id');
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd api
npx jest --runInBand --testPathPatterns=server/services/MessageGrafts/clone.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/server/services/MessageGrafts/clone.js \
  api/server/services/MessageGrafts/clone.spec.js
git commit -m "feat: clone generation graft records safely"
```

### Task 5: Implement Preview, Create, Inspect, and Undo

**Files:**
- Create: `api/server/services/MessageGrafts/index.js`
- Create: `api/server/services/MessageGrafts/index.spec.js`

- [ ] **Step 1: Write failing service tests for the complete/partial matrix**

Use a table that covers every stable pairing:

```js
describe.each([
  ['complete', 'complete'],
  ['stopped_partial', 'complete'],
  ['complete', 'stopped_partial'],
  ['aborted_partial', 'errored_partial'],
])('%s source to %s destination', (sourceState, destinationState) => {
  it('previews and creates without rejecting stable partial history', async () => {
    const preview = await service.preview({
      userId: 'user-1',
      conversationId: 'convo-1',
      payload: {
        sourceMessageId: 'source',
        destinationMessageId: 'destination',
        mode: 'generation',
      },
    });
    expect(preview.sourceState).toBe(sourceState);
    expect(preview.destinationState).toBe(destinationState);
    expect(preview.canCreate).toBe(true);
  });
});
```

Add separate tests that assert:

```js
await expect(
  service.preview({
    userId: 'user-1',
    conversationId: 'convo-1',
    payload: {
      sourceMessageId: 'streaming-source',
      destinationMessageId: 'destination',
      mode: 'generation',
    },
  }),
).rejects.toMatchObject({
  code: 'GRAFT_REQUIRES_STABILIZATION',
  statusCode: 409,
  activeMessageIds: ['streaming-source'],
});
```

Also cover subtree remapping, ownership, overlap, stale revision, 250-message limit, payload limit, idempotent retry, insert failure cleanup, undo without continuations, and `GRAFT_HAS_CONTINUATIONS`.

- [ ] **Step 2: Run the service test and verify it fails**

Run:

```bash
cd api
npx jest --runInBand --testPathPatterns=server/services/MessageGrafts/index.spec.js
```

Expected: FAIL because `index.js` does not exist.

- [ ] **Step 3: Implement preview loading and counting**

Create `api/server/services/MessageGrafts/index.js` with dependency-injected defaults:

```js
const { v4: uuidv4 } = require('uuid');
const { Message, ToolCall, Transaction } = require('~/db/models');
const {
  MAX_GRAFT_MESSAGES,
  MAX_GRAFT_PAYLOAD_BYTES,
  PARTIAL_GRAFT_WARNING,
  GenerationGraftError,
} = require('./constants');
const { getActiveGenerationState } = require('./active');
const {
  buildMessageGraph,
  classifyLifecycle,
  collectDescendantIds,
  validateSelection,
} = require('./graph');
const { computeTreeRevision } = require('./revision');
const { buildClonePlan } = require('./clone');

const conversationLocks = new Set();

function approximateTokens(message) {
  if (Number.isFinite(message.tokenCount)) {
    return Math.max(0, Number(message.tokenCount));
  }
  return Math.ceil(String(message.text ?? '').length / 4);
}

function countArtifacts(messages, toolCalls) {
  const serialized = JSON.stringify({ messages, toolCalls });
  const imagePattern = /\.(png|jpe?g|webp|gif)(\?|$)/i;
  const files = messages.reduce(
    (total, message) => total + (message.files?.length ?? 0) + (message.attachments?.length ?? 0),
    0,
  );
  const images = messages.reduce((total, message) => {
    const values = [...(message.files ?? []), ...(message.attachments ?? [])];
    return total + values.filter((value) => imagePattern.test(value?.filepath ?? value?.filename ?? '')).length;
  }, 0);
  return {
    messages: messages.length,
    toolCalls: toolCalls.length,
    files,
    images,
    approximateTokens: messages.reduce((total, message) => total + approximateTokens(message), 0),
    payloadBytes: Buffer.byteLength(serialized),
  };
}
```

The internal preview must:

1. load `Message.find({ user: userId, conversationId }).sort({ createdAt: 1 }).lean()`;
2. load active state with `getActiveGenerationState`;
3. validate source and destination;
4. choose `[source]` for generation mode or `collectDescendantIds` for subtree mode;
5. block if the canonical active response is source, destination, or in the copied set;
6. block the whole conversation if active state lacks a response message ID;
7. validate `sourceActiveLeafMessageId` belongs to the copied set;
8. bulk-load ToolCalls for copied IDs;
9. enforce count and payload limits;
10. compute revision and warnings;
11. return `canCreate: true` for every stable complete/partial pairing.

- [ ] **Step 4: Implement create with idempotency and compensating cleanup**

The create flow must use this order:

```js
async function create({ userId, conversationId, payload }) {
  const lockKey = `${userId}:${conversationId}`;
  if (conversationLocks.has(lockKey)) {
    throw new GenerationGraftError('GRAFT_BUSY', 'Another graft is already being created.', 409);
  }
  conversationLocks.add(lockKey);
  let insertedMessageIds = [];
  try {
    const existingBridge = await Message.findOne({
      user: userId,
      conversationId,
      'metadata.generationGraft.idempotencyKey': payload.idempotencyKey,
    }).lean();
    if (existingBridge) {
      return responseFromExistingBridge(existingBridge);
    }

    const preview = await previewInternal({ userId, conversationId, payload });
    if (preview.treeRevision !== payload.expectedTreeRevision) {
      throw new GenerationGraftError('TREE_CHANGED', 'Conversation changed after preview.', 409);
    }

    const selectedMessages = preview.copiedMessageIds.map((messageId) =>
      preview.graph.byId.get(messageId),
    );
    const toolCalls = await ToolCall.find({
      user: userId,
      conversationId,
      messageId: { $in: preview.copiedMessageIds },
    }).lean();
    const graftId = uuidv4();
    const plan = buildClonePlan({
      messages: selectedMessages,
      toolCalls,
      destinationMessageId: payload.destinationMessageId,
      userId,
      conversationId,
      graftId,
      idempotencyKey: payload.idempotencyKey,
      sourceState: preview.sourceState,
      destinationState: preview.destinationState,
      mode: payload.mode,
      activeSourceLeafMessageId: preview.activeSourceLeafMessageId,
    });

    insertedMessageIds = plan.messages.map((message) => message.messageId);
    await Message.insertMany(plan.messages, { ordered: true });
    if (plan.toolCalls.length > 0) {
      await ToolCall.insertMany(plan.toolCalls, { ordered: true });
    }
    const verified = await Message.countDocuments({
      user: userId,
      conversationId,
      messageId: { $in: insertedMessageIds },
    });
    if (verified !== insertedMessageIds.length) {
      throw new Error('Inserted graft verification failed.');
    }
    return {
      graftId,
      bridgeMessageId: plan.bridgeMessageId,
      copiedRootMessageId: plan.copiedRootMessageId,
      activeCopiedMessageId: plan.activeCopiedMessageId,
      copiedMessageCount: plan.copiedMessageIds.length,
      createdMessages: plan.messages,
    };
  } catch (error) {
    if (insertedMessageIds.length > 0) {
      await Promise.allSettled([
        Message.deleteMany({
          user: userId,
          conversationId,
          messageId: { $in: insertedMessageIds },
        }),
        ToolCall.deleteMany({
          user: userId,
          conversationId,
          messageId: { $in: insertedMessageIds },
        }),
      ]);
    }
    throw error;
  } finally {
    conversationLocks.delete(lockKey);
  }
}
```

`responseFromExistingBridge` must reconstruct the same response and load the bridge plus copied messages in topological order.

- [ ] **Step 5: Implement inspect and guarded undo**

The inspect flow finds the owned bridge using:

```js
{
  user: userId,
  conversationId,
  'metadata.generationGraft.graftId': graftId,
  'metadata.generationGraft.kind': 'generation_graft',
}
```

It loads all owned conversation messages, computes descendants of the bridge, and separates:

```js
const graftIds = new Set([bridge.messageId, ...metadata.copiedMessageIds]);
const descendantIds = collectDescendantIds(graph, bridge.messageId);
const continuationMessageIds = descendantIds.filter((messageId) => !graftIds.has(messageId));
```

Undo must reject continuations unless `includeContinuations === true`, then delete Message, ToolCall, and Transaction rows scoped by user, conversation, and selected IDs. Use the same transaction-capability pattern as `api/models/Message.js:363-428`; use a Mongoose session when supported and ordered compensating deletes otherwise.

- [ ] **Step 6: Run the full service test**

Run:

```bash
cd api
npx jest --runInBand --testPathPatterns=server/services/MessageGrafts
```

Expected: PASS with complete/partial, active, idempotency, cleanup, and undo cases.

- [ ] **Step 7: Commit**

```bash
git add api/server/services/MessageGrafts/index.js \
  api/server/services/MessageGrafts/index.spec.js
git commit -m "feat: implement generation graft service"
```

### Task 6: Add Rate-Limited Message Routes

**Files:**
- Create: `api/server/middleware/limiters/graftLimiters.js`
- Modify: `api/server/middleware/limiters/index.js:1-35`
- Modify: `api/server/routes/messages.js:1-120`
- Create: `api/server/routes/__tests__/messages-grafts.spec.js`

- [ ] **Step 1: Write failing route tests**

```js
it('returns 409 and the stabilization payload from preview', async () => {
  previewGenerationGraft.mockRejectedValue(
    Object.assign(new Error('Generation is still active.'), {
      statusCode: 409,
      code: 'GRAFT_REQUIRES_STABILIZATION',
      activeMessageIds: ['assistant-live'],
    }),
  );

  const response = await request(app)
    .post('/api/messages/convo-1/grafts/preview')
    .send({
      sourceMessageId: 'assistant-live',
      destinationMessageId: 'assistant-complete',
      mode: 'generation',
    });

  expect(response.status).toBe(409);
  expect(response.body).toEqual({
    error: 'Generation is still active.',
    code: 'GRAFT_REQUIRES_STABILIZATION',
    activeMessageIds: ['assistant-live'],
    conversationActiveWithoutMessageId: false,
  });
});
```

Add create, inspect, undo, invalid body, 404, 413, and 429 tests.

- [ ] **Step 2: Run the route test and verify it fails**

Run:

```bash
cd api
npx jest --runInBand --testPathPatterns=server/routes/__tests__/messages-grafts.spec.js
```

Expected: FAIL because the routes and limiter do not exist.

- [ ] **Step 3: Implement dedicated preview and mutation limiters**

Create `api/server/middleware/limiters/graftLimiters.js` with:

```js
const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');
const logViolation = require('~/cache/logViolation');

function positiveInt(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function makeHandler(limiter) {
  return async (req, res) => {
    const details = { type: 'generation_graft_limit', limiter };
    await logViolation(req, res, 'generation_graft_limit', details);
    res.status(429).json({ message: 'Too many graft requests. Try again later.' });
  };
}

function createLimiter({ name, max, keyGenerator, handler }) {
  return rateLimit({
    windowMs: positiveInt('GRAFT_RATE_WINDOW_MINUTES', 1) * 60 * 1000,
    max,
    keyGenerator,
    handler,
    store: limiterCache(name),
  });
}

function createGraftLimiters() {
  return {
    graftPreviewIpLimiter: createLimiter({
      name: 'graft_preview_ip_limiter',
      max: positiveInt('GRAFT_PREVIEW_IP_MAX', 120),
      handler: makeHandler('preview-ip'),
    }),
    graftPreviewUserLimiter: createLimiter({
      name: 'graft_preview_user_limiter',
      max: positiveInt('GRAFT_PREVIEW_USER_MAX', 60),
      keyGenerator: (req) => req.user?.id,
      handler: makeHandler('preview-user'),
    }),
    graftMutationIpLimiter: createLimiter({
      name: 'graft_mutation_ip_limiter',
      max: positiveInt('GRAFT_MUTATION_IP_MAX', 30),
      handler: makeHandler('mutation-ip'),
    }),
    graftMutationUserLimiter: createLimiter({
      name: 'graft_mutation_user_limiter',
      max: positiveInt('GRAFT_MUTATION_USER_MAX', 10),
      keyGenerator: (req) => req.user?.id,
      handler: makeHandler('mutation-user'),
    }),
  };
}

module.exports = { createGraftLimiters };
```

Export `createGraftLimiters` from `api/server/middleware/limiters/index.js`.

- [ ] **Step 4: Add routes before `/:conversationId` and `/:conversationId/:messageId`**

At the top of `api/server/routes/messages.js`, import:

```js
const {
  previewGenerationGraft,
  createGenerationGraft,
  getGenerationGraft,
  undoGenerationGraft,
} = require('~/server/services/MessageGrafts');
const { createGraftLimiters } = require('~/server/middleware');
```

Create one error responder:

```js
function sendGraftError(res, error) {
  const statusCode = error.statusCode ?? 500;
  return res.status(statusCode).json({
    error: statusCode === 500 ? 'Internal server error' : error.message,
    code: error.code,
    activeMessageIds: error.activeMessageIds,
    conversationActiveWithoutMessageId:
      error.conversationActiveWithoutMessageId === true,
  });
}
```

Mount:

```js
const {
  graftPreviewIpLimiter,
  graftPreviewUserLimiter,
  graftMutationIpLimiter,
  graftMutationUserLimiter,
} = createGraftLimiters();

router.post(
  '/:conversationId/grafts/preview',
  graftPreviewIpLimiter,
  graftPreviewUserLimiter,
  async (req, res) => {
    try {
      const result = await previewGenerationGraft({
        userId: req.user.id,
        conversationId: req.params.conversationId,
        payload: req.body ?? {},
      });
      res.status(200).json(result);
    } catch (error) {
      logger.error('Error previewing generation graft:', error);
      sendGraftError(res, error);
    }
  },
);

router.post(
  '/:conversationId/grafts',
  graftMutationIpLimiter,
  graftMutationUserLimiter,
  async (req, res) => {
    try {
      const result = await createGenerationGraft({
        userId: req.user.id,
        conversationId: req.params.conversationId,
        payload: req.body ?? {},
      });
      res.status(201).json(result);
    } catch (error) {
      logger.error('Error creating generation graft:', error);
      sendGraftError(res, error);
    }
  },
);

router.get('/:conversationId/grafts/:graftId', async (req, res) => {
  try {
    res.status(200).json(
      await getGenerationGraft({
        userId: req.user.id,
        conversationId: req.params.conversationId,
        graftId: req.params.graftId,
      }),
    );
  } catch (error) {
    sendGraftError(res, error);
  }
});

router.delete(
  '/:conversationId/grafts/:graftId',
  graftMutationIpLimiter,
  graftMutationUserLimiter,
  async (req, res) => {
    try {
      res.status(200).json(
        await undoGenerationGraft({
          userId: req.user.id,
          conversationId: req.params.conversationId,
          graftId: req.params.graftId,
          includeContinuations: req.body?.includeContinuations === true,
        }),
      );
    } catch (error) {
      sendGraftError(res, error);
    }
  },
);
```

- [ ] **Step 5: Run route, deletion, fork, and usage tests**

Run:

```bash
cd api
npx jest --runInBand \
  --testPathPatterns=server/routes/__tests__/messages-grafts.spec.js \
  --testPathPatterns=server/routes/__tests__/messages-delete.spec.js \
  --testPathPatterns=server/utils/import/fork.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/server/middleware/limiters/graftLimiters.js \
  api/server/middleware/limiters/index.js \
  api/server/routes/messages.js \
  api/server/routes/__tests__/messages-grafts.spec.js
git commit -m "feat: expose rate-limited generation graft routes"
```

### Task 7: Add Provider-Aware Stop and Graft Data Hooks

**Files:**
- Modify: `client/src/data-provider/SSE/mutations.ts`
- Modify: `client/src/data-provider/SSE/queries.ts`
- Modify: `client/src/hooks/Chat/useChatHelpers.ts`
- Create: `client/src/data-provider/Messages/generationGrafts.ts`
- Modify: `client/src/data-provider/Messages/index.ts`
- Create: `client/src/data-provider/Messages/generationGrafts.spec.tsx`

- [ ] **Step 1: Write failing cache and stop tests**

```tsx
it('appends created messages once and invalidates usage and tool calls', async () => {
  mockCreateGenerationGraft.mockResolvedValue({
    graftId: 'graft-1',
    bridgeMessageId: 'bridge-1',
    copiedRootMessageId: 'copy-1',
    activeCopiedMessageId: 'copy-1',
    copiedMessageCount: 1,
    createdMessages: [
      { messageId: 'bridge-1', conversationId: 'convo-1' },
      { messageId: 'copy-1', conversationId: 'convo-1' },
    ],
  });

  const { result } = renderHook(() => useCreateGenerationGraft('convo-1'), { wrapper });
  await act(async () => {
    await result.current.mutateAsync(request);
  });

  expect(queryClient.getQueryData([QueryKeys.messages, 'convo-1'])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ messageId: 'bridge-1' }),
      expect.objectContaining({ messageId: 'copy-1' }),
    ]),
  );
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd client
npx jest --runInBand --testPathPatterns=data-provider/Messages/generationGrafts.spec.tsx
```

Expected: FAIL because the hooks do not exist.

- [ ] **Step 3: Add provider-aware cancellation**

In `client/src/data-provider/SSE/mutations.ts`, add:

```ts
import {
  EndpointURLs,
  type EModelEndpoint,
  apiBaseUrl,
  request,
} from 'librechat-data-provider';

export async function stopGeneration({
  conversationId,
  endpoint,
  latestMessageId,
}: {
  conversationId: string;
  endpoint?: EModelEndpoint | string | null;
  latestMessageId?: string | null;
}) {
  const isAssistantEndpoint =
    endpoint === 'assistants' || endpoint === 'azureAssistants';
  if (!isAssistantEndpoint) {
    return abortStream({ conversationId });
  }
  return request.post(`${apiBaseUrl()}${EndpointURLs[endpoint]}/abort`, {
    abortKey: `${conversationId}:${latestMessageId ?? ''}`,
    endpoint,
  });
}
```

Update `useChatHelpers.stopGenerating()` to `await stopGeneration(...)` for every provider, clear submissions only after the request settles, invalidate `[QueryKeys.messages, targetConversationId]`, and keep the existing optimistic active-jobs removal for resumable jobs.

- [ ] **Step 4: Add polling support without changing existing callers**

Change:

```ts
export function useStreamStatus(
  conversationId: string | undefined,
  enabled = true,
  refetchInterval: number | false = false,
) {
  return useQuery({
    queryKey: streamStatusQueryKey(conversationId || ''),
    queryFn: () => fetchStreamStatus(conversationId!),
    enabled: !!conversationId && enabled,
    staleTime: 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval,
    retry: false,
  });
}
```

- [ ] **Step 5: Implement graft hooks and cache reconciliation**

Create `client/src/data-provider/Messages/generationGrafts.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';

export function usePreviewGenerationGraft(conversationId: string) {
  return useMutation((payload: t.TGenerationGraftPreviewRequest) =>
    dataService.previewGenerationGraft(conversationId, payload),
  );
}

export function useCreateGenerationGraft(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: t.TGenerationGraftCreateRequest) =>
      dataService.createGenerationGraft(conversationId, payload),
    {
      onSuccess: (data) => {
        queryClient.setQueryData<t.TMessage[]>(
          [QueryKeys.messages, conversationId],
          (current = []) => {
            const known = new Set(current.map((message) => message.messageId));
            return [
              ...current,
              ...data.createdMessages.filter((message) => !known.has(message.messageId)),
            ];
          },
        );
        queryClient.invalidateQueries([QueryKeys.messages, conversationId]);
        queryClient.invalidateQueries([QueryKeys.toolCalls, conversationId]);
        queryClient.invalidateQueries([QueryKeys.conversationUsage, conversationId]);
      },
    },
  );
}

export function useGenerationGraftDetails(
  conversationId: string,
  graftId: string | null,
  enabled: boolean,
) {
  return useQuery(
    [QueryKeys.messages, conversationId, 'graft', graftId],
    () => dataService.getGenerationGraft(conversationId, graftId!),
    { enabled: enabled && !!conversationId && !!graftId, retry: false },
  );
}

export function useUndoGenerationGraft(conversationId: string, graftId: string) {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: t.TGenerationGraftUndoRequest) =>
      dataService.undoGenerationGraft(conversationId, graftId, payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.messages, conversationId]);
        queryClient.invalidateQueries([QueryKeys.toolCalls, conversationId]);
        queryClient.invalidateQueries([QueryKeys.conversationUsage, conversationId]);
      },
    },
  );
}
```

Export from `client/src/data-provider/Messages/index.ts`.

- [ ] **Step 6: Run client data tests**

Run:

```bash
cd client
npx jest --runInBand \
  --testPathPatterns=data-provider/Messages/generationGrafts.spec.tsx \
  --testPathPatterns=hooks/Chat/useChatHelpers
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/data-provider/SSE/mutations.ts \
  client/src/data-provider/SSE/queries.ts \
  client/src/hooks/Chat/useChatHelpers.ts \
  client/src/data-provider/Messages/generationGrafts.ts \
  client/src/data-provider/Messages/generationGrafts.spec.tsx \
  client/src/data-provider/Messages/index.ts
git commit -m "feat: add graft mutations and stream stabilization"
```

### Task 8: Add Actionable Toasts for Immediate Undo

**Files:**
- Modify: `packages/client/src/common/types.ts:1-15`
- Modify: `client/src/common/types.ts:280-290`
- Modify: `packages/client/src/store.ts:5-25`
- Modify: `packages/client/src/hooks/useToast.ts:1-75`
- Modify: `packages/client/src/Providers/ToastContext.tsx:1-25`
- Modify: `packages/client/src/components/Toast.tsx:1-80`
- Create: `packages/client/src/components/Toast.spec.tsx`

- [ ] **Step 1: Write the failing toast action test**

```tsx
it('renders and invokes an accessible toast action', async () => {
  const onAction = jest.fn();
  render(
    <ToastTestHarness
      toast={{
        message: 'Graft created',
        actionLabel: 'Undo',
        onAction,
      }}
    />,
  );

  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(onAction).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the package-client test and verify failure**

Run:

```bash
cd packages/client
npx jest --runInBand --testPathPatterns=components/Toast.spec.tsx
```

Expected: FAIL because toast actions are unsupported.

- [ ] **Step 3: Extend the toast contract and state**

Add to both `TShowToast` definitions:

```ts
actionLabel?: string;
onAction?: () => void;
```

Add to `ToastState`:

```ts
actionLabel?: string;
onAction?: () => void;
```

Store both fields in `useToast.showToast()`. When closing or replacing a toast, clear stale callbacks:

```ts
setToast({
  open: true,
  message,
  severity: (status as NotificationSeverity) ?? severity,
  showIcon,
  actionLabel,
  onAction,
});
```

- [ ] **Step 4: Render the Radix toast action**

Inside `packages/client/src/components/Toast.tsx`:

```tsx
{toast.actionLabel && toast.onAction && (
  <RadixToast.Action
    altText={toast.actionLabel}
    asChild
  >
    <button
      type="button"
      className="ml-2 rounded border border-white/70 px-2 py-1 text-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      onClick={() => {
        toast.onAction?.();
        onOpenChange(false);
      }}
    >
      {toast.actionLabel}
    </button>
  </RadixToast.Action>
)}
```

- [ ] **Step 5: Run tests and build package client**

Run:

```bash
cd packages/client
npx jest --runInBand --testPathPatterns=components/Toast.spec.tsx
cd ../..
npm run build:client-package
```

Expected: PASS and package build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/common/types.ts \
  client/src/common/types.ts \
  packages/client/src/store.ts \
  packages/client/src/hooks/useToast.ts \
  packages/client/src/Providers/ToastContext.tsx \
  packages/client/src/components/Toast.tsx \
  packages/client/src/components/Toast.spec.tsx
git commit -m "feat: add toast actions for immediate undo"
```

### Task 9: Normalize and Lay Out the Conversation Tree

**Files:**
- Create: `client/src/components/Chat/Tree/types.ts`
- Create: `client/src/components/Chat/Tree/graph.ts`
- Create: `client/src/components/Chat/Tree/layout.ts`
- Create: `client/src/components/Chat/Tree/storage.ts`
- Create: `client/src/components/Chat/Tree/graph.spec.ts`
- Create: `client/src/components/Chat/Tree/layout.spec.ts`
- Create: `client/src/components/Chat/Tree/storage.spec.ts`

- [ ] **Step 1: Write failing layout tests**

```ts
it('centers parents between visible children in left-to-right mode', () => {
  const graph = normalizeConversationGraph(messages);
  const layout = layoutConversationTree(graph, {
    orientation: 'horizontal',
    collapsedIds: new Set(),
    manualPositions: new Map(),
  });

  const parent = layout.nodes.get('prompt')!;
  const first = layout.nodes.get('assistant-a')!;
  const second = layout.nodes.get('assistant-b')!;
  expect(parent.y).toBe((first.y + second.y) / 2);
  expect(first.x).toBeGreaterThan(parent.x);
});

it('hides descendants and reports their count when a node is collapsed', () => {
  const graph = normalizeConversationGraph(messages);
  const layout = layoutConversationTree(graph, {
    orientation: 'horizontal',
    collapsedIds: new Set(['assistant-b']),
    manualPositions: new Map(),
  });
  expect(layout.nodes.has('assistant-b-child')).toBe(false);
  expect(layout.hiddenDescendantCounts.get('assistant-b')).toBe(2);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd client
npx jest --runInBand \
  --testPathPatterns=components/Chat/Tree/graph.spec.ts \
  --testPathPatterns=components/Chat/Tree/layout.spec.ts \
  --testPathPatterns=components/Chat/Tree/storage.spec.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Define graph and layout types**

`types.ts` must define:

```ts
export type TreeOrientation = 'horizontal' | 'vertical';
export type TreeSemanticDetail = 'far' | 'medium' | 'near';

export type ConversationTreeNode = {
  id: string;
  parentId: string | null;
  childIds: string[];
  message: TMessage;
  role: 'user' | 'assistant' | 'graft_bridge';
  lifecycle: TGenerationGraftLifecycleState;
  generationIndex: number;
  graftId?: string;
  clonedFromMessageId?: string;
  searchableText: string;
};

export type PositionedTreeNode = ConversationTreeNode & {
  x: number;
  y: number;
  width: number;
  height: number;
};
```

- [ ] **Step 4: Implement normalization and valid-target reasons**

`graph.ts` must:

- flatten the existing nested `children` arrays and tolerate flat message arrays;
- classify `metadata.generationGraft` as `graft_bridge`;
- classify stable `unfinished` nodes as partial and the current active response as streaming;
- assign sibling generation numbers among assistant children;
- expose `getInvalidGraftReason(graph, sourceId, destinationId)`;
- expose `searchTreeNodes(graph, query)`;
- expose semantic detail thresholds:

```ts
export function semanticDetail(scale: number): TreeSemanticDetail {
  if (scale < 0.55) return 'far';
  if (scale < 1.05) return 'medium';
  return 'near';
}
```

- [ ] **Step 5: Implement deterministic layout**

Use fixed dimensions:

```ts
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 92;
export const HORIZONTAL_GAP = 96;
export const VERTICAL_GAP = 28;
```

Recursively lay out visible leaves first, center parents over children, offset multiple roots, and apply manual positions last. Return:

```ts
{
  nodes: Map<string, PositionedTreeNode>,
  edges: Array<{ id: string; sourceId: string; targetId: string }>,
  bounds: { x: number; y: number; width: number; height: number },
  hiddenDescendantCounts: Map<string, number>,
}
```

- [ ] **Step 6: Implement safe local storage**

Use keys:

```ts
const collapseKey = (conversationId: string) =>
  `generation-tree:${conversationId}:collapsed`;
const orientationKey = 'generation-tree:orientation';
```

Parse with `try/catch`, discard non-array collapse values, and never write message content or coordinates.

- [ ] **Step 7: Run tests**

Run:

```bash
cd client
npx jest --runInBand --testPathPatterns=components/Chat/Tree
```

Expected: pure graph/layout/storage tests PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/Chat/Tree/types.ts \
  client/src/components/Chat/Tree/graph.ts \
  client/src/components/Chat/Tree/layout.ts \
  client/src/components/Chat/Tree/storage.ts \
  client/src/components/Chat/Tree/graph.spec.ts \
  client/src/components/Chat/Tree/layout.spec.ts \
  client/src/components/Chat/Tree/storage.spec.ts
git commit -m "feat: add conversation tree graph layout"
```

### Task 10: Mount One Shared Tree Dialog and Entry Points

**Files:**
- Create: `client/src/Providers/GenerationTreeContext.tsx`
- Modify: `client/src/Providers/index.ts`
- Modify: `client/src/components/Chat/Presentation.tsx`
- Create: `client/src/components/SidePanel/Tree/ConversationTreePanel.tsx`
- Create: `client/src/components/SidePanel/Tree/index.ts`
- Modify: `client/src/hooks/Nav/useSideNavLinks.ts`
- Create: `client/src/components/Chat/Tree/GenerationTreeActions.tsx`
- Modify: `client/src/components/Chat/Messages/HoverButtons.tsx`
- Modify: `client/src/locales/en/translation.json`
- Create: `client/src/Providers/GenerationTreeContext.spec.tsx`

- [ ] **Step 1: Write failing provider tests**

```tsx
it('opens focused browse mode and source-selected graft mode', async () => {
  render(
    <GenerationTreeProvider>
      <OpenButtons />
    </GenerationTreeProvider>,
  );

  await userEvent.click(screen.getByRole('button', { name: 'View assistant-1' }));
  expect(screen.getByTestId('generation-tree-dialog')).toHaveAttribute(
    'data-focused-message-id',
    'assistant-1',
  );

  await userEvent.click(screen.getByRole('button', { name: 'Graft assistant-2' }));
  expect(screen.getByTestId('generation-tree-dialog')).toHaveAttribute(
    'data-source-message-id',
    'assistant-2',
  );
});
```

- [ ] **Step 2: Run the provider test and verify failure**

Run:

```bash
cd client
npx jest --runInBand --testPathPatterns=Providers/GenerationTreeContext.spec.tsx
```

Expected: FAIL because the provider does not exist.

- [ ] **Step 3: Implement the provider**

The context contract:

```ts
type OpenGenerationTreeOptions = {
  focusMessageId?: string;
  sourceMessageId?: string;
};

type GenerationTreeContextValue = {
  open: boolean;
  focusMessageId: string | null;
  sourceMessageId: string | null;
  openTree: (options?: OpenGenerationTreeOptions) => void;
  closeTree: () => void;
};
```

Render one `ConversationTreeDialog` inside the provider and reset focus/source only after close animation completes. Wrap `SidePanelGroup` in `Presentation.tsx`:

```tsx
<GenerationTreeProvider>
  <SidePanelGroup>{children}</SidePanelGroup>
</GenerationTreeProvider>
```

- [ ] **Step 4: Add side-panel and per-message entries**

Add a `Network` icon link in `useSideNavLinks.ts`:

```ts
links.push({
  title: 'com_sidepanel_conversation_tree',
  label: '',
  icon: Network,
  id: 'conversation-tree',
  Component: ConversationTreePanel,
});
```

`ConversationTreePanel` renders a short description and a full-width button that calls `openTree()`.

`GenerationTreeActions` renders only for assistant messages:

```tsx
<button
  type="button"
  title={localize('com_ui_view_in_conversation_tree')}
  onClick={() => openTree({ focusMessageId: message.messageId })}
>
  <Network size={19} />
</button>
<button
  type="button"
  title={localize('com_ui_graft_generation')}
  onClick={() =>
    openTree({
      focusMessageId: message.messageId,
      sourceMessageId: message.messageId,
    })
  }
>
  <GitMerge size={19} />
</button>
```

Mount immediately after the existing Fork control.

- [ ] **Step 5: Add English localization keys**

Add keys for:

- Conversation Tree;
- Open conversation tree;
- View in conversation tree;
- Graft generation;
- source, destination, generation only, generation and subtree;
- complete, stopped partial, aborted partial, errored partial, streaming;
- stop and graft current partial output;
- wait for it to finish;
- partial-context warning;
- stale-tree, overlap, busy, too-large, and continuation errors;
- fit tree, fit active branch, fit selection, orientation, expand/collapse, arrange, reset layout;
- screen-reader announcements.

- [ ] **Step 6: Run provider and hover-button tests**

Run:

```bash
cd client
npx jest --runInBand \
  --testPathPatterns=Providers/GenerationTreeContext.spec.tsx \
  --testPathPatterns=components/Chat/Messages
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/Providers/GenerationTreeContext.tsx \
  client/src/Providers/GenerationTreeContext.spec.tsx \
  client/src/Providers/index.ts \
  client/src/components/Chat/Presentation.tsx \
  client/src/components/SidePanel/Tree \
  client/src/hooks/Nav/useSideNavLinks.ts \
  client/src/components/Chat/Tree/GenerationTreeActions.tsx \
  client/src/components/Chat/Messages/HoverButtons.tsx \
  client/src/locales/en/translation.json
git commit -m "feat: add conversation tree entry points"
```

### Task 11: Build the Interactive Canvas, Mini-Map, and Accessible List

**Files:**
- Create: `client/src/components/Chat/Tree/ConversationTreeDialog.tsx`
- Create: `client/src/components/Chat/Tree/ConversationTreeToolbar.tsx`
- Create: `client/src/components/Chat/Tree/ConversationTreeCanvas.tsx`
- Create: `client/src/components/Chat/Tree/ConversationTreeNode.tsx`
- Create: `client/src/components/Chat/Tree/ConversationTreeMiniMap.tsx`
- Create: `client/src/components/Chat/Tree/ConversationTreeList.tsx`
- Create: `client/src/components/Chat/Tree/useGenerationTreeDrag.ts`
- Create: `client/src/components/Chat/Tree/__tests__/ConversationTreeCanvas.spec.tsx`
- Create: `client/src/components/Chat/Tree/__tests__/ConversationTreeDialog.spec.tsx`

- [ ] **Step 1: Write failing interaction tests**

Test these exact behaviors:

```tsx
it('starts graft drag only from the dedicated handle and opens preview on a valid drop', async () => {
  render(<ConversationTreeCanvas {...props} />);
  fireEvent.pointerDown(screen.getByTestId('graft-handle-assistant-b'), {
    pointerId: 1,
    clientX: 40,
    clientY: 40,
  });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 220, clientY: 80 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 220, clientY: 80 });
  expect(onSelectDestination).toHaveBeenCalledWith('assistant-a');
  expect(onRequestPreview).toHaveBeenCalled();
});

it('keeps node-body dragging reserved for arrange mode', () => {
  render(<ConversationTreeCanvas {...props} arrangeMode={false} />);
  fireEvent.pointerDown(screen.getByTestId('tree-node-assistant-a'), {
    pointerId: 1,
  });
  expect(onManualPositionChange).not.toHaveBeenCalled();
});

it('supports keyboard source and destination selection', async () => {
  render(<ConversationTreeList {...props} />);
  const source = screen.getByRole('treeitem', { name: /generation 2/i });
  source.focus();
  await userEvent.keyboard(' ');
  const destination = screen.getByRole('treeitem', { name: /generation 1/i });
  destination.focus();
  await userEvent.keyboard('{Enter}');
  expect(onSelectSource).toHaveBeenCalled();
  expect(onSelectDestination).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd client
npx jest --runInBand --testPathPatterns=components/Chat/Tree/__tests__
```

Expected: FAIL because canvas components do not exist.

- [ ] **Step 3: Implement the full-screen responsive shell**

Use `OGDialog` and a portal-backed content class:

```tsx
<OGDialogContent
  data-testid="generation-tree-dialog"
  className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-hidden rounded-none border-0 bg-surface-primary p-0"
>
  <div className="grid h-full grid-rows-[auto_1fr]">
    <ConversationTreeToolbar />
    <div className="relative min-h-0 md:grid md:grid-cols-[minmax(0,1fr)_360px]">
      <ConversationTreeCanvas />
      <ConversationTreeInspector />
    </div>
  </div>
</OGDialogContent>
```

On screens below `768px`, render the inspector as a bottom sheet with a sticky source/destination summary.

- [ ] **Step 4: Implement transformed canvas and fit controls**

Use:

```tsx
<TransformWrapper
  ref={transformRef}
  initialScale={1}
  minScale={0.25}
  maxScale={2}
  limitToBounds={false}
  centerOnInit
  wheel={{ step: 0.08 }}
  panning={{ velocityDisabled: true, excluded: ['graft-handle', 'tree-node-control'] }}
  alignmentAnimation={{ disabled: true }}
  onTransformed={(_, state) => setTransformState(state)}
>
  <TransformComponent wrapperClass="h-full w-full" contentClass="relative">
    <svg className="pointer-events-none absolute inset-0 overflow-visible">
      {edges.map(renderCubicEdge)}
    </svg>
    {nodes.map(renderPositionedNode)}
  </TransformComponent>
</TransformWrapper>
```

Implement fit calculations from layout bounds and viewport dimensions. Clamp scale to `0.25..2`. `ResizeObserver` schedules one animation-frame fit recalculation and cancels prior frames.

- [ ] **Step 5: Implement custom pointer graft drag**

`useGenerationTreeDrag` must:

- call `setPointerCapture` on the dedicated handle;
- track pointer coordinates in animation frames;
- use `document.elementsFromPoint(clientX, clientY)` and `data-tree-node-id`;
- call `getInvalidGraftReason` before highlighting;
- auto-expand a collapsed valid target after 600 ms;
- pan when the pointer is within 48 px of the viewport edge;
- cancel on `Escape`, pointer cancellation, or invalid drop;
- never call create directly; valid drop only selects destination and requests preview.

- [ ] **Step 6: Implement semantic nodes, mini-map, and list**

Node detail:

- far: role color, generation number, lifecycle icon;
- medium: sender/model and one-line excerpt;
- near: multiline excerpt plus tool/file/image/reasoning/provenance badges.

Mini-map scales layout bounds into a `180x112` SVG and converts click coordinates back into the main transform.

The list uses `role="tree"` and `role="treeitem"`, `aria-level`, `aria-expanded`, roving `tabIndex`, arrow-key parent/child/sibling movement, `Space` source selection, `Enter` destination selection, and `Escape` cancellation.

- [ ] **Step 7: Run interaction tests**

Run:

```bash
cd client
npx jest --runInBand --testPathPatterns=components/Chat/Tree
```

Expected: PASS for layout, canvas, mini-map, keyboard, and responsive dialog tests.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/Chat/Tree/ConversationTreeDialog.tsx \
  client/src/components/Chat/Tree/ConversationTreeToolbar.tsx \
  client/src/components/Chat/Tree/ConversationTreeCanvas.tsx \
  client/src/components/Chat/Tree/ConversationTreeNode.tsx \
  client/src/components/Chat/Tree/ConversationTreeMiniMap.tsx \
  client/src/components/Chat/Tree/ConversationTreeList.tsx \
  client/src/components/Chat/Tree/useGenerationTreeDrag.ts \
  client/src/components/Chat/Tree/__tests__
git commit -m "feat: add interactive conversation tree canvas"
```

### Task 12: Implement Preview, Stabilization, Creation, Focus, and Undo UI

**Files:**
- Create: `client/src/components/Chat/Tree/useGenerationGraft.ts`
- Create: `client/src/components/Chat/Tree/ConversationTreeInspector.tsx`
- Modify: `client/src/components/Chat/Tree/ConversationTreeDialog.tsx`
- Create: `client/src/components/Chat/Tree/__tests__/useGenerationGraft.spec.tsx`
- Create: `client/src/components/Chat/Tree/__tests__/ConversationTreeInspector.spec.tsx`

- [ ] **Step 1: Write failing state-machine tests**

```tsx
it('retains source and destination while waiting for an active generation', async () => {
  mockPreview.mockRejectedValueOnce(
    axiosError(409, {
      code: 'GRAFT_REQUIRES_STABILIZATION',
      activeMessageIds: ['source-live'],
    }),
  );
  mockStreamStatus.mockReturnValue({ data: { active: true } });

  const { result, rerender } = renderHook(() => useGenerationGraft(props), { wrapper });
  await act(() => result.current.preview());
  expect(result.current.phase).toBe('stabilization');

  act(() => result.current.waitForCompletion());
  mockStreamStatus.mockReturnValue({ data: { active: false } });
  rerender();

  await waitFor(() => expect(mockPreview).toHaveBeenCalledTimes(2));
  expect(result.current.sourceMessageId).toBe('source-live');
  expect(result.current.destinationMessageId).toBe('destination');
});

it('stops, waits for persistence, refreshes messages, and previews again', async () => {
  await act(() => result.current.stopAndGraft());
  expect(stopGenerating).toHaveBeenCalled();
  expect(refetchMessages).toHaveBeenCalled();
  expect(mockPreview).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd client
npx jest --runInBand \
  --testPathPatterns=components/Chat/Tree/__tests__/useGenerationGraft.spec.tsx \
  --testPathPatterns=components/Chat/Tree/__tests__/ConversationTreeInspector.spec.tsx
```

Expected: FAIL because the hook and inspector do not exist.

- [ ] **Step 3: Implement the graft state machine**

The hook phases are:

```ts
type GraftPhase =
  | 'idle'
  | 'selecting'
  | 'previewing'
  | 'stabilization'
  | 'ready'
  | 'creating'
  | 'created'
  | 'undo-preview'
  | 'undoing'
  | 'error';
```

The hook must:

- hold source, destination, mode, preview, and error;
- call client-immediate validation before the server;
- parse `TGenerationGraftErrorResponse`;
- retain selection after recoverable errors;
- generate one UUID idempotency key per selection/revision;
- call `stopGenerating()` for Stop and graft;
- poll status every 500 ms while waiting;
- refetch messages before retrying preview;
- disable Create until server preview matches current source/destination/mode/revision;
- set the created `activeCopiedMessageId` as latest after appending created messages;
- call fit-selection after create;
- show a 10-second success toast with `Undo`;
- load undo details before destructive continuation deletion.

The stabilization loop must stop after 30 seconds with an actionable error and must never submit transient content.

- [ ] **Step 4: Implement the inspector**

Render:

- source and destination cards with state badges;
- generation-only and subtree radio controls;
- authoritative counts;
- partial warning when either state is not complete;
- active-stream dialog with Stop and graft, Wait, and Cancel;
- before/after compact branch preview;
- disabled Create until `phase === 'ready'`;
- undo details and the exact `Undo graft and delete later continuation` label.

- [ ] **Step 5: Run state-machine tests**

Run:

```bash
cd client
npx jest --runInBand --testPathPatterns=components/Chat/Tree
```

Expected: PASS, including complete/partial combinations and active stop/wait paths.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Chat/Tree/useGenerationGraft.ts \
  client/src/components/Chat/Tree/ConversationTreeInspector.tsx \
  client/src/components/Chat/Tree/ConversationTreeDialog.tsx \
  client/src/components/Chat/Tree/__tests__/useGenerationGraft.spec.tsx \
  client/src/components/Chat/Tree/__tests__/ConversationTreeInspector.spec.tsx
git commit -m "feat: add graft preview stabilization and undo flow"
```

### Task 13: Render Graft Bridges in the Transcript

**Files:**
- Create: `client/src/components/Chat/Tree/GraftBridgeCard.tsx`
- Create: `client/src/components/Chat/Tree/__tests__/GraftBridgeCard.spec.tsx`
- Modify: `client/src/components/Chat/Messages/Content/MessageContent.tsx`
- Modify: `client/src/components/Chat/Messages/MessageParts.tsx`
- Modify: `client/src/components/Chat/Messages/ui/MessageRender.tsx`

- [ ] **Step 1: Write the failing bridge-card test**

```tsx
it('renders provenance and safe undo instead of a user bubble', async () => {
  render(
    <GraftBridgeCard
      message={{
        messageId: 'bridge-1',
        conversationId: 'convo-1',
        isCreatedByUser: true,
        metadata: {
          generationGraft: {
            kind: 'generation_graft',
            graftId: 'graft-1',
            sourceRootMessageId: 'source-1',
            sourceState: 'stopped_partial',
            destinationState: 'complete',
          },
        },
      }}
    />,
  );

  expect(screen.getByText(/grafted generation/i)).toBeVisible();
  expect(screen.getByText(/partial/i)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: /undo graft/i }));
  expect(mockDetailsQuery).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the bridge test and verify failure**

Run:

```bash
cd client
npx jest --runInBand --testPathPatterns=components/Chat/Tree/__tests__/GraftBridgeCard.spec.tsx
```

Expected: FAIL because the card does not exist.

- [ ] **Step 3: Implement the bridge card**

The card must:

- show source generation ID suffix and complete/partial states;
- offer View in tree;
- offer Undo graft;
- display copied message count;
- avoid rendering fixed bridge text as normal user content;
- use a muted dashed purple border;
- expose an accessible summary.

At the start of both text and structured message renderers:

```tsx
const graftMetadata = message.metadata?.generationGraft as
  | TGenerationGraftMetadata
  | undefined;

if (graftMetadata?.kind === 'generation_graft') {
  return <GraftBridgeCard message={message} metadata={graftMetadata} />;
}
```

In `MessageRender.tsx`, detect bridge metadata and suppress the normal avatar and user heading while preserving the message ID anchor and branch controls.

- [ ] **Step 4: Run transcript tests**

Run:

```bash
cd client
npx jest --runInBand \
  --testPathPatterns=components/Chat/Tree/__tests__/GraftBridgeCard.spec.tsx \
  --testPathPatterns=components/Chat/Messages
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Chat/Tree/GraftBridgeCard.tsx \
  client/src/components/Chat/Tree/__tests__/GraftBridgeCard.spec.tsx \
  client/src/components/Chat/Messages/Content/MessageContent.tsx \
  client/src/components/Chat/Messages/MessageParts.tsx \
  client/src/components/Chat/Messages/ui/MessageRender.tsx
git commit -m "feat: render graft provenance and undo cards"
```

### Task 14: Add Browser Coverage for Drag, Partial Pairings, and Undo

**Files:**
- Create: `e2e/specs/generation-tree-grafting.spec.ts`

- [ ] **Step 1: Add authenticated synthetic fixture helpers**

Use `page.request` with the existing authenticated storage state. Generate UUIDs, then seed:

```ts
async function seedMessage(page: Page, conversationId: string, message: Partial<TMessage>) {
  const response = await page.request.post(`/api/messages/${conversationId}`, {
    data: {
      conversationId,
      endpoint: 'openAI',
      model: 'gpt-5.6-sol',
      sender: message.isCreatedByUser ? 'User' : 'Assistant',
      text: '',
      unfinished: false,
      error: false,
      ...message,
    },
  });
  expect(response.ok()).toBeTruthy();
}
```

Create one root user prompt and two sibling assistant generations. Stable partial fixtures use `unfinished: true`; errored partial uses `error: true`.

- [ ] **Step 2: Implement the desktop drag/drop and undo scenario**

The test must:

1. navigate to the seeded conversation;
2. open Conversation Tree;
3. drag Generation 2's graft handle to Generation 1;
4. assert no new bridge exists before preview confirmation;
5. confirm generation-only;
6. assert the transcript contains the bridge card and copied generation;
7. seed one later continuation beneath the copied generation;
8. assert first undo attempt shows continuation warning;
9. confirm destructive undo;
10. assert original Generation 2 still exists.

- [ ] **Step 3: Add the four stable lifecycle pairings**

Use:

```ts
for (const fixture of [
  { source: 'complete', destination: 'complete' },
  { source: 'partial', destination: 'complete' },
  { source: 'complete', destination: 'partial' },
  { source: 'partial', destination: 'partial' },
]) {
  test(`${fixture.source} to ${fixture.destination}`, async ({ page }) => {
    // Seed exact lifecycle flags, graft, confirm, and verify state badges.
  });
}
```

Each case must assert successful creation and partial warning visibility when applicable.

- [ ] **Step 4: Add keyboard and mobile scenarios**

Keyboard:

- open list view;
- focus source;
- press Space;
- focus destination;
- press Enter;
- confirm preview.

Mobile:

- viewport `390x844`;
- long-press source handle;
- tap destination;
- inspector opens as bottom sheet;
- confirm and undo.

- [ ] **Step 5: Run the browser test against dev**

Start dev only after production is confirmed healthy:

```bash
./local-services/status-all.sh all
./local-services/start-all.sh dev --no-build
npx playwright test e2e/specs/generation-tree-grafting.spec.ts \
  --config=e2e/playwright.config.local.ts
./local-services/stop-all.sh dev
```

Expected: all graft browser cases PASS and dev is stopped afterward.

- [ ] **Step 6: Commit**

```bash
git add e2e/specs/generation-tree-grafting.spec.ts
git commit -m "test: cover interactive generation tree grafting"
```

### Task 15: Document and Protect the Customization

**Files:**
- Create: `GENERATION_TREE_GRAFTING.md`
- Create: `local-services/verify-generation-tree-grafting.sh`
- Modify: `CUSTOMIZATION_MASTER_DOC.md`
- Modify: `CUSTOMIZATION_MASTER_GUIDE.md`
- Modify: `docs/superpowers/specs/2026-07-06-interactive-generation-tree-grafting-design.md`

- [ ] **Step 1: Write the focused guide**

`GENERATION_TREE_GRAFTING.md` must contain:

- copy-and-graft semantics and why multi-parent history is not used;
- generation-only versus subtree;
- every complete/partial pairing;
- active Stop and graft versus Wait behavior;
- bridge role ordering;
- provenance metadata;
- ToolCall, file, image, and attachment behavior;
- immediate and guarded undo;
- limits and environment variables;
- unit, browser, dev, and production verification commands;
- rollback and incident diagnosis.

- [ ] **Step 2: Add a preservation verifier**

Create executable `local-services/verify-generation-tree-grafting.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="$ROOT_DIR"

if [[ "${1:-}" == "--container" ]]; then
  CONTAINER="${2:?container name required}"
  TARGET_ROOT="/app"
  docker exec "$CONTAINER" test -f "$TARGET_ROOT/api/server/services/MessageGrafts/index.js"
  docker exec "$CONTAINER" grep -Fq "/:conversationId/grafts/preview" \
    "$TARGET_ROOT/api/server/routes/messages.js"
  docker exec "$CONTAINER" grep -Fq "generationGraft" \
    "$TARGET_ROOT/api/server/services/MessageGrafts/clone.js"
  echo "generation-tree-grafting:PASS container=$CONTAINER"
  exit 0
fi

test -f "$TARGET_ROOT/api/server/services/MessageGrafts/index.js"
test -f "$TARGET_ROOT/client/src/components/Chat/Tree/ConversationTreeDialog.tsx"
grep -Fq "/:conversationId/grafts/preview" "$TARGET_ROOT/api/server/routes/messages.js"
grep -Fq "com_sidepanel_conversation_tree" \
  "$TARGET_ROOT/client/src/locales/en/translation.json"
grep -Fq "Generation Tree Grafting" "$TARGET_ROOT/CUSTOMIZATION_MASTER_DOC.md"
echo "generation-tree-grafting:PASS source=$TARGET_ROOT"
```

- [ ] **Step 3: Update canonical customization docs**

Add a protected customization section to `CUSTOMIZATION_MASTER_DOC.md` describing:

- files;
- API contract;
- lifecycle matrix;
- cross-provider active-state resolution;
- clone and undo invariants;
- deployment class;
- regression tests;
- RCA warning that `unfinished` alone must never block stable partial grafts or authorize active transient cloning.

Add all high-risk files and the verifier command to `CUSTOMIZATION_MASTER_GUIDE.md`.

- [ ] **Step 4: Run the verifier**

Run:

```bash
chmod +x local-services/verify-generation-tree-grafting.sh
./local-services/verify-generation-tree-grafting.sh
```

Expected: `generation-tree-grafting:PASS`.

- [ ] **Step 5: Commit**

```bash
git add GENERATION_TREE_GRAFTING.md \
  local-services/verify-generation-tree-grafting.sh \
  CUSTOMIZATION_MASTER_DOC.md \
  CUSTOMIZATION_MASTER_GUIDE.md \
  docs/superpowers/specs/2026-07-06-interactive-generation-tree-grafting-design.md
git commit -m "docs: protect generation tree grafting"
```

### Task 16: Run Focused and Preservation Validation

**Files:**
- No source changes unless a validation failure exposes a defect.

- [ ] **Step 1: Run focused backend tests**

```bash
cd api
npx jest --runInBand \
  --testPathPatterns=server/services/MessageGrafts \
  --testPathPatterns=server/routes/__tests__/messages-grafts.spec.js \
  --testPathPatterns=server/routes/__tests__/messages-delete.spec.js \
  --testPathPatterns=server/utils/import/fork.spec.js
```

Expected: PASS.

- [ ] **Step 2: Run focused package and client tests**

```bash
cd ../packages/data-provider
npx jest --runInBand --testPathPatterns=generationGrafts.spec.ts
cd ../client
npx jest --runInBand --testPathPatterns=components/Toast.spec.tsx
cd ../../client
npx jest --runInBand \
  --testPathPatterns=components/Chat/Tree \
  --testPathPatterns=data-provider/Messages/generationGrafts.spec.tsx \
  --testPathPatterns=components/Chat/Messages
```

Expected: PASS.

- [ ] **Step 3: Run typecheck and protected runtime contracts**

```bash
npm run build:data-provider
npm run build:client-package
cd client && npm run typecheck && cd ..
npm run verify:openai-reasoning-preservation
npm run test:refresh-token-runtime-contract
npm run verify:refresh-token-runtime-contract
npm run verify:auth-memory-runtime-contracts
./local-services/verify-generation-tree-grafting.sh
```

Expected: every command PASS.

- [ ] **Step 4: Build the complete client with capped resources**

```bash
./local-services/run-node-capped.sh \
  --memory-max 12G \
  --heap-mb 8192 \
  -- npm run build:client
```

Expected: `client/dist` and its integrity manifest are created without OOM.

- [ ] **Step 5: Review the diff and confirm no unrelated dirty-worktree content entered**

```bash
git status --short
git diff --check
git diff --stat HEAD~15..HEAD
git log --oneline --decorate -20
```

Expected: no whitespace errors, no secrets, and only graft-related feature/docs/tests.

### Task 17: Validate on the Non-Production Dev Rail

**Files:**
- No source changes unless validation fails.

- [ ] **Step 1: Confirm production is healthy before starting dev**

```bash
curl -fsS https://librechatvm.tail6e13ff.ts.net:8443/api/config >/dev/null
ssh timeng@192.168.50.104 \
  'cd /opt/LibreChat-custom && docker compose -p librechat-stable \
  -f docker-compose.yml -f docker-compose.local.override.yml ps'
```

Expected: `/api/config` succeeds and the `LibreChat` container is healthy/running.

- [ ] **Step 2: Start or refresh dev only**

Classify backend files:

```bash
./local-services/deploy-runtime-delta.sh dev --dry-run -- \
  api/server/services/MessageGrafts/constants.js \
  api/server/services/MessageGrafts/active.js \
  api/server/services/MessageGrafts/graph.js \
  api/server/services/MessageGrafts/revision.js \
  api/server/services/MessageGrafts/clone.js \
  api/server/services/MessageGrafts/index.js \
  api/server/middleware/limiters/graftLimiters.js \
  api/server/middleware/limiters/index.js \
  api/server/routes/messages.js \
  api/server/controllers/assistants/chatV1.js \
  api/server/controllers/assistants/chatV2.js \
  api/server/middleware/abortRun.js
```

Then use the helper-selected dev path and deploy the manifest-verified client dist:

```bash
./local-services/deploy-runtime-delta.sh dev -- \
  api/server/services/MessageGrafts/constants.js \
  api/server/services/MessageGrafts/active.js \
  api/server/services/MessageGrafts/graph.js \
  api/server/services/MessageGrafts/revision.js \
  api/server/services/MessageGrafts/clone.js \
  api/server/services/MessageGrafts/index.js \
  api/server/middleware/limiters/graftLimiters.js \
  api/server/middleware/limiters/index.js \
  api/server/routes/messages.js \
  api/server/controllers/assistants/chatV1.js \
  api/server/controllers/assistants/chatV2.js \
  api/server/middleware/abortRun.js
./local-services/deploy-built-client-dist.sh dev
```

Expected: dev health passes after each guarded operation.

- [ ] **Step 3: Run browser and direct API validation**

```bash
npx playwright test e2e/specs/generation-tree-grafting.spec.ts \
  --config=e2e/playwright.config.local.ts
curl -fsS http://127.0.0.1:3081/api/config >/dev/null
```

Capture the synthetic dev conversation ID and graft ID in the validation notes.

- [ ] **Step 4: Verify production remained healthy throughout dev validation**

```bash
for attempt in 1 2 3; do
  curl -fsS https://librechatvm.tail6e13ff.ts.net:8443/api/config >/dev/null
  sleep 5
done
```

Expected: all three checks PASS.

- [ ] **Step 5: Stop dev after validation**

```bash
./local-services/stop-all.sh dev
```

Expected: dev stops and VM stable remains healthy.

### Task 18: Guardedly Promote and Prove Production

**Files:**
- Production runtime only; no source edits.

- [ ] **Step 1: Confirm the production maintenance preconditions**

Run:

```bash
curl -fsS https://librechatvm.tail6e13ff.ts.net:8443/api/config >/dev/null
ssh timeng@192.168.50.104 \
  'free -h && docker stats --no-stream LibreChat'
npm run test:refresh-token-runtime-contract
npm run verify:refresh-token-runtime-contract
npm run verify:auth-memory-runtime-contracts
npm run verify:openai-reasoning-preservation
./local-services/verify-generation-tree-grafting.sh
```

Expected: production healthy, memory headroom present, and every contract PASS.

- [ ] **Step 2: Promote backend runtime files with the guarded stable helper**

```bash
LIBRECHAT_STABLE_RUNTIME_DELTA_APPROVAL=YES \
  ./local-services/deploy-runtime-delta.sh stable --approve-stable -- \
  api/server/services/MessageGrafts/constants.js \
  api/server/services/MessageGrafts/active.js \
  api/server/services/MessageGrafts/graph.js \
  api/server/services/MessageGrafts/revision.js \
  api/server/services/MessageGrafts/clone.js \
  api/server/services/MessageGrafts/index.js \
  api/server/middleware/limiters/graftLimiters.js \
  api/server/middleware/limiters/index.js \
  api/server/routes/messages.js \
  api/server/controllers/assistants/chatV1.js \
  api/server/controllers/assistants/chatV2.js \
  api/server/middleware/abortRun.js
```

Expected: helper snapshots, restarts only as part of the deployment, health-checks, and rolls back automatically on failure.

- [ ] **Step 3: Promote the complete client dist**

```bash
LIBRECHAT_STABLE_CLIENT_APPROVAL=YES \
  ./local-services/deploy-built-client-dist.sh stable --approve-stable
```

Expected: manifest verification, atomic full-tree swap, guarded API restart, asset verification, and automatic rollback on failure.

- [ ] **Step 4: Verify deployed runtime contracts**

```bash
ssh timeng@192.168.50.104 \
  'cd /opt/LibreChat-custom && \
  ./local-services/verify-generation-tree-grafting.sh --container LibreChat && \
  ./local-services/verify-openai-reasoning-preservation.sh --container LibreChat && \
  ./local-services/verify-refresh-token-runtime-contract.sh --container LibreChat'
curl -fsS https://librechatvm.tail6e13ff.ts.net:8443/api/config >/dev/null
```

Expected: all deployed-runtime verifiers PASS.

- [ ] **Step 5: Run production browser proof with synthetic test IDs**

Using the existing synthetic test account:

1. seed a new production test conversation;
2. record its conversation ID;
3. perform complete-to-complete drag/drop graft;
4. record returned graft ID;
5. perform partial-to-complete and partial-to-partial grafts;
6. continue beneath one copied generation;
7. verify guarded undo;
8. verify immediate undo on a graft without continuations;
9. verify the original source branch still renders;
10. verify new chat, retry, existing fork, and generation-tree deletion still work;
11. verify the session remains authenticated after deployment.

Run:

```bash
BASE_URL=https://librechatvm.tail6e13ff.ts.net:8443 \
  npx playwright test e2e/specs/generation-tree-grafting.spec.ts \
  --config=e2e/playwright.config.local.ts
```

Expected: PASS. Save the production test conversation ID and graft IDs in the final handoff.

- [ ] **Step 6: Recheck production health repeatedly**

```bash
for attempt in 1 2 3 4 5; do
  curl -fsS https://librechatvm.tail6e13ff.ts.net:8443/api/config >/dev/null
  sleep 10
done
ssh timeng@192.168.50.104 \
  'docker inspect LibreChat --format "status={{.State.Status}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}"'
```

Expected: all HTTP checks PASS, `oom=false`, and restart count does not increase after deployment stabilization.

### Task 19: Final Review and Branch Handoff

**Files:**
- No source changes unless review finds a defect.

- [ ] **Step 1: Run final source and deployment evidence checks**

```bash
git status --short
git diff --check
git log --oneline --decorate --max-count=25
./local-services/verify-generation-tree-grafting.sh
```

Expected: clean feature worktree and PASS.

- [ ] **Step 2: Review all acceptance criteria against evidence**

Confirm evidence exists for:

- generation-only and subtree;
- complete-to-complete;
- partial-to-complete;
- complete-to-partial;
- partial-to-partial;
- active Stop and graft;
- active Wait;
- no transient browser cloning;
- tool/file/image preservation;
- source preservation;
- pan/zoom/pinch/fit/search/orientation;
- expand/collapse persistence;
- mini-map;
- mouse, touch-equivalent, keyboard, and screen-reader list;
- immediate and guarded undo;
- stale, overlap, ownership, duplicate, size, busy, and rate-limit errors;
- production auth/session persistence and health.

- [ ] **Step 3: Push only after the implementation and production proof are complete**

```bash
git push origin codex/interactive-tree-grafting
```

Expected: remote branch contains the reviewed commits. Do not merge into another branch or rewrite history unless explicitly requested.
