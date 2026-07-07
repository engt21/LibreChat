# Interactive Generation Tree Grafting Design

**Status:** Reviewed; amended to support complete and incomplete generation pairings
**Date:** 2026-07-06
**Repository:** `/pool/home/timeng/LibreChat-custom`
**Implementation worktree:** `/pool/home/timeng/LibreChat-tree-grafting`

## 1. Summary

LibreChat will gain a fully interactive conversation-tree workspace that lets a user visually
graft an assistant generation, or its complete descendant subtree, onto another assistant
generation in the same conversation. Sources and destinations may be complete, stopped partial,
aborted, or errored generations.

The graft is non-destructive:

- the source generation remains in its original location;
- the destination branch receives a copied generation or copied subtree;
- a compact bridge message preserves valid user/assistant role ordering;
- provenance records where the graft came from;
- the operation can be undone without affecting the original source;
- existing single-parent tree behavior remains intact.

The primary gesture is direct drag and drop: drag a source generation by its graft handle and drop
it on a valid destination generation. Click/tap selection and a keyboard-accessible list provide
equivalent alternatives.

## 2. User Goal

The motivating case is:

```text
Prompt
├── Generation 1
└── Generation 2
```

The user wants to graft Generation 2 onto Generation 1 and continue from the combined branch:

```text
Prompt
├── Generation 1
│   └── Graft bridge: copied from Generation 2
│       └── Generation 2′
└── Generation 2
```

`Generation 2′` is a copy. The original Generation 2 remains unchanged.

## 3. Goals

1. Make the complete conversation tree easy to understand on desktop and mobile.
2. Support drag-and-drop grafting with clear valid and invalid drop targets.
3. Keep all original branches intact.
4. Preserve provider-compatible message ordering.
5. Support copying one generation or its complete descendant subtree.
6. Preserve displayed content, attachments, tool results, and relevant metadata.
7. Make grafts easy to identify, inspect, navigate, and undo.
8. Keep the existing message store as a single-parent tree.
9. Prevent stale, duplicate, oversized, cross-user, or partial graft operations.
10. Preserve all July 5-6 production customizations and deployment safeguards.
11. Support complete-to-complete, partial-to-complete, complete-to-partial, and
    partial-to-partial grafts.

## 4. Non-Goals

The initial release will not:

- convert message history into a multi-parent directed acyclic graph;
- destructively move or reparent the original source messages;
- merge conversations owned by different users;
- merge messages across different conversations;
- automatically ask a model to reconcile contradictory answers;
- rerun historical tools;
- clone an actively mutating stream without first stabilizing or waiting for it;
- persist arbitrary manual graph coordinates as conversation data.

Cross-conversation grafting and model-assisted synthesis may be designed separately after the
same-conversation workflow is validated.

## 5. Why Copy-and-Graft

Every LibreChat message currently has one `parentMessageId`. History construction, sibling
navigation, regeneration, deletion, usage accounting, forks, sharing, imports, and provider request
formatting all depend on that invariant.

A true multi-parent merge would require changing all those systems to understand a graph. Copying
the selected source under the destination preserves the existing invariant and gives the user the
combined context they want.

The original source remains available, so a mistaken graft is recoverable even if undo is not used.

## 6. Graft Semantics

### 6.1 Valid source

A source must be:

- owned by the authenticated user;
- in the current conversation;
- an assistant generation;
- in a stable complete or incomplete state before the mutation is committed;
- free of an actively mutating descendant inside the selected copied region when subtree mode is
  used.

### 6.2 Valid destination

A destination must be:

- owned by the authenticated user;
- in the same conversation;
- an assistant generation in a stable complete or incomplete state before commit;
- different from the source;
- outside the source's ancestor and descendant set.

Blocking ancestor/descendant overlap prevents confusing recursive copies such as grafting an
ancestor beneath one of its own descendants.

### 6.3 Generation lifecycle states

The graft workflow distinguishes persisted completeness from live stream activity:

1. **Complete** — the generation finished normally.
2. **Stopped partial** — generation was stopped and its partial output was persisted.
3. **Aborted partial** — generation ended through an abort path and retained partial output.
4. **Errored partial** — generation ended with an error and retained partial output.
5. **Actively streaming** — the generation is still changing.

The `unfinished` database flag alone is not authoritative because stale historical rows may retain
that flag. The server combines persisted message state with the canonical active-generation status.
Resumable streams use `GenerationJobManager`; Assistants runs use the existing `ABORT_KEYS` run
registry, extended to retain the response message ID and cleared immediately when the run settles.

Complete, stopped, aborted, and errored generations are immediately graftable in every source and
destination combination.

An actively streaming generation must be resolved before the graft mutation:

- **Stop and graft current partial output** aborts the stream, waits for final persistence, refreshes
  the tree revision, and opens the authoritative preview.
- **Wait for it to finish** keeps the source and destination selection, watches canonical generation
  status, and automatically refreshes the preview when the stream settles.
- **Cancel** returns to the unchanged graph.

If both selected regions contain active streams, each active stream must settle before confirmation.
The graft is never built from browser-only transient text.

### 6.4 Supported pairing matrix

Every stable combination is supported:

| Source | Destination | Behavior |
| --- | --- | --- |
| Complete | Complete | Copy normally |
| Partial | Complete | Copy partial source with an explicit partial-context warning |
| Complete | Partial | Attach after the stable partial destination |
| Partial | Partial | Preserve both partial states and warn that neither is a complete answer |

Here, Partial means stopped, aborted, or errored output that is no longer actively mutating.

### 6.5 Copy modes

The confirmation inspector offers:

1. **Generation only** — copy only the selected assistant generation.
2. **Generation and subtree** — copy the selected generation and every descendant beneath it.

Generation only is the default.

### 6.6 Bridge message

Two sibling generations are both assistant messages. Directly parenting one assistant message under
another would create consecutive assistant roles and could break provider-specific message
validation.

The backend inserts a synthetic user-role bridge between the destination and copied source:

```text
Destination assistant
└── Synthetic graft bridge (user role)
    └── Copied source assistant
```

For a complete source and destination, the bridge text is fixed application text, not
user-controlled prompt text:

> An alternate completed assistant generation was grafted into this branch. Treat the following
> assistant message and any copied continuation as prior conversation context.

The normal transcript renders this as a compact graft card rather than a user chat bubble.

If either side is incomplete, the fixed bridge text additionally states:

> One or both grafted generations are incomplete. Treat their content as partial prior context and
> do not assume that either represents a finished answer.

The bridge metadata retains the exact source and destination lifecycle states so future rendering
does not depend on mutable historical flags.

### 6.7 Active continuation

After a successful graft:

- generation-only mode selects the copied generation as the active latest message;
- subtree mode selects the copied equivalent of the source branch's active leaf when that leaf is
  inside the copied subtree;
- otherwise subtree mode selects the copied source root.

The user can immediately continue chatting from the grafted branch.

## 7. Interactive Tree Workspace

### 7.1 Entry points

The workspace is available from:

- a new **Conversation Tree** control in the right side panel;
- a **View in tree** action in assistant-message hover controls;
- a **Graft generation** action adjacent to the existing Fork action.

Opening from a message focuses that message in the tree.

### 7.2 Desktop layout

The desktop workspace is a full-screen modal with three regions:

1. **Toolbar** — fit, zoom, expand/collapse, focus, search, help, and close controls.
2. **Graph canvas** — the interactive tree.
3. **Inspector** — selected source, destination, copy mode, warnings, preview, and confirmation.

The inspector is resizable and collapsible. Collapsing it gives the graph the full viewport.

### 7.3 Mobile layout

On narrow screens the workspace becomes a full-screen sheet:

- the graph occupies the main view;
- the inspector opens as a bottom sheet;
- source and destination selection remain visible in a sticky status bar;
- long-press followed by drop, or source-then-destination taps, replaces mouse drag precision.

### 7.4 Graph orientation

The default orientation is left-to-right:

- conversation roots appear on the left;
- depth increases to the right;
- siblings are arranged vertically;
- the currently visible branch is centered where practical.

The user can switch to top-to-bottom orientation. Orientation is a local UI preference.

### 7.5 Automatic layout

The client derives a deterministic layout from the existing message tree:

- parent nodes are centered relative to visible children;
- collapsed subtrees occupy one row;
- minimum node and branch spacing prevents overlap;
- graph bounds are recalculated after every expand, collapse, search, orientation, resize, graft, or
  undo action;
- `ResizeObserver` triggers a bounded fit recalculation when the viewport changes.

No new graph-layout runtime dependency is required. The first implementation uses a focused tree
layout helper and SVG edges.

### 7.6 Fit and semantic zoom

The graph must remain understandable at different sizes:

- **Fit tree** fits all currently expanded nodes.
- **Fit active branch** centers and fits the selected conversation branch.
- **Fit selection** frames the source, destination, and proposed graft.
- zoom range is bounded from 25% to 200%;
- mouse wheel or trackpad zooms around the pointer;
- pinch zoom works on touch devices;
- toolbar buttons and keyboard shortcuts provide deterministic alternatives.

Semantic zoom changes node detail:

- far zoom: role color, generation number, and status only;
- medium zoom: sender/model and one-line snippet;
- near zoom: multi-line snippet plus tool, file, image, error, and provenance badges.

### 7.7 Pan and node dragging

Interactions do not compete:

- dragging empty canvas pans;
- wheel/trackpad and pinch control zoom;
- dragging a node's dedicated graft handle starts graft drag-and-drop;
- clicking the node body selects and focuses it;
- an optional local **Arrange** mode lets users reposition nodes temporarily without changing
  message relationships;
- **Reset layout** discards manual positions.

Manual positions are kept only in local UI state and are never treated as conversation history.

### 7.8 Drag-and-drop grafting

When a source handle is dragged:

- the source and its copied region are highlighted purple;
- valid assistant destinations highlight blue;
- invalid destinations dim and expose the rejection reason on hover or focus;
- a dashed provisional edge follows the pointer;
- hovering a collapsed valid destination auto-expands its ancestor path after a short delay;
- edge panning scrolls the canvas while dragging;
- dropping on a valid destination opens the authoritative preview inspector;
- dropping elsewhere cancels without mutation.

The mutation never occurs immediately on drop. The user must confirm the preview.

### 7.9 Click and keyboard alternatives

Every drag action has an equivalent:

- click **Choose source**, then click a source node;
- click **Choose destination**, then click a destination node;
- keyboard arrows move between parent, child, and sibling nodes;
- `Space` selects the source;
- `Enter` selects the destination or confirms the focused inspector action;
- `Escape` cancels graft mode;
- a synchronized hierarchical list view supports screen readers and users who prefer linear
  navigation.

### 7.10 Expand and collapse behavior

The initial tree state:

- expands the complete active branch;
- expands the ancestor paths of the focused message;
- expands graft bridge cards on the active branch;
- collapses unrelated subtrees after a configurable visible-node threshold.

Controls include:

- **Expand all**;
- **Collapse all except active branch**;
- **Expand one level**;
- **Collapse siblings**;
- per-node expand/collapse;
- search-result auto-expansion;
- hidden-descendant count badges.

Expansion state is stored per conversation in local storage. It does not mutate server data.

For very large trees, Expand all first shows the resulting node count and requires confirmation
above the safety threshold.

### 7.11 Mini-map and navigation

A collapsible mini-map shows:

- the complete tree bounds;
- the current viewport;
- the active branch;
- source, destination, and graft-provenance edges.

Clicking or dragging the mini-map viewport navigates the main canvas.

### 7.12 Node appearance

Nodes communicate:

- user versus assistant role;
- sibling generation number;
- current branch membership;
- endpoint and model;
- unfinished, error, or aborted status;
- tool-call count;
- files and images;
- reasoning presence;
- graft source, copied generation, or graft bridge provenance.

Node text is truncated safely, with full content available in the inspector.

## 8. Preview Inspector

Before confirmation, the inspector shows:

- source and destination excerpts;
- source and destination lifecycle states;
- copy mode;
- exact message count;
- approximate copied token count;
- tool-call, file, and image counts;
- whether descendants will be copied;
- the destination's existing child count;
- the active leaf after completion;
- any warnings;
- a compact before/after branch preview.

The client computes an immediate preview for responsiveness, then calls the server preview endpoint.
Confirmation is disabled until the authoritative server preview agrees with the current selection.

## 9. Provenance

The synthetic bridge stores graft metadata in the existing mixed `metadata` field:

```ts
type GenerationGraftMetadata = {
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
  mode: 'generation' | 'subtree';
  sourceState: 'complete' | 'stopped_partial' | 'aborted_partial' | 'errored_partial';
  destinationState: 'complete' | 'stopped_partial' | 'aborted_partial' | 'errored_partial';
  createdAt: string;
};
```

Each copied message stores:

```ts
type GenerationGraftCopyMetadata = {
  kind: 'generation_graft_copy';
  graftId: string;
  clonedFromMessageId: string;
};
```

The graph draws a dashed purple provenance edge from the original source to the graft bridge. This
edge is visual metadata, not a second `parentMessageId`.

## 10. API Design

### 10.1 Preview

```http
POST /api/messages/:conversationId/grafts/preview
```

Request:

```json
{
  "sourceMessageId": "source-id",
  "destinationMessageId": "destination-id",
  "mode": "generation",
  "sourceActiveLeafMessageId": "active-leaf-id",
  "expectedTreeRevision": "revision"
}
```

Response includes authoritative counts, warnings, active copied source leaf, and a tree revision.
If a selected region is actively streaming, the response identifies the active message IDs and
returns `GRAFT_REQUIRES_STABILIZATION` without mutating anything.

### 10.2 Create

```http
POST /api/messages/:conversationId/grafts
```

Request:

```json
{
  "sourceMessageId": "source-id",
  "destinationMessageId": "destination-id",
  "mode": "generation",
  "sourceActiveLeafMessageId": "active-leaf-id",
  "idempotencyKey": "client-uuid",
  "expectedTreeRevision": "revision"
}
```

Response:

```json
{
  "graftId": "graft-uuid",
  "bridgeMessageId": "bridge-id",
  "copiedRootMessageId": "copied-root-id",
  "activeCopiedMessageId": "active-copy-id",
  "copiedMessageCount": 1,
  "createdMessages": []
}
```

`sourceActiveLeafMessageId` is optional. When it is supplied for subtree mode, the server validates
that it belongs to the copied set and maps it to the cloned equivalent. Otherwise the copied root
becomes active. `createdMessages` contains the topologically ordered bridge and copied records so
the client can update the message cache immediately, select the active copy, and then reconcile with
an authoritative refetch.

### 10.3 Undo preview and undo

```http
GET /api/messages/:conversationId/grafts/:graftId
DELETE /api/messages/:conversationId/grafts/:graftId
```

The GET response reports copied messages and later continuations that would be deleted.

The DELETE request defaults to refusing deletion when non-graft continuations exist. A second
explicit confirmation sends:

```json
{
  "includeContinuations": true
}
```

## 11. Tree Revision and Stale-Preview Protection

The server computes a deterministic revision from the owned conversation message set using message
IDs, parent IDs, completion state, and update timestamps.

Preview returns that revision. Create must provide the same revision. If the conversation changes,
the server responds with `409 TREE_CHANGED`; the client refreshes the graph and asks the user to
review the updated preview.

## 12. Backend Operation

The service performs:

1. user and conversation ownership validation;
2. source and destination lookup;
3. cross-provider lifecycle classification and active-generation validation;
4. ancestor/descendant overlap validation;
5. copied-set calculation;
6. node-count and payload-size validation;
7. tree-revision validation;
8. idempotency lookup;
9. new message-ID mapping;
10. synthetic bridge creation;
11. message cloning with remapped parent IDs;
12. embedded attachment `messageId` remapping;
13. tool-call record cloning with new message IDs;
14. insertion;
15. verification of the inserted graft;
16. response with the active copied message.

If insertion or verification fails, compensating cleanup deletes every message and tool-call record
carrying the new graft ID.

## 13. Tool Calls, Files, and Attachments

Copied messages preserve historical results; they never rerun tools.

For each copied message:

- embedded message content is copied;
- attachment metadata is copied;
- attachment `messageId` values are remapped;
- file references continue to point to the same user-owned stored files;
- persisted tool-call records are copied with the new message ID;
- tool-call attachments are copied and remapped;
- generated image paths remain shared immutable artifacts.

Deleting or undoing a graft removes copied database references but does not delete a shared file or
image still referenced by the original source.

## 14. Easy Undo

Undo is available from:

- the success toast for a short period;
- the graft bridge card in the transcript;
- the graft bridge node in the graph inspector.

If no later continuation exists, undo requires one confirmation and removes only the bridge and
copied records.

If later messages descend from the graft, the dialog shows:

- copied graft message count;
- later user and assistant continuation count;
- tool-call and attachment counts;
- the exact branch preview that will disappear.

The user must explicitly choose **Undo graft and delete later continuation**.

The original source branch is never deleted.

## 15. Limits and Rate Control

Initial safeguards:

- maximum 250 copied messages per graft;
- maximum bounded serialized payload size;
- per-user graft preview and mutation rate limits;
- one active graft mutation per conversation;
- server timeout with compensating cleanup;
- no graft commit while the selected source, destination, or copied subtree is actively mutating;
- no graft of expired or missing attachment references without a visible warning.

Limits are configuration constants and can be adjusted after production measurements.

## 16. Error Handling

Expected errors include:

- `404 MESSAGE_NOT_FOUND`;
- `400 INVALID_SOURCE`;
- `400 INVALID_DESTINATION`;
- `400 OVERLAPPING_BRANCHES`;
- `409 GRAFT_REQUIRES_STABILIZATION`;
- `409 TREE_CHANGED`;
- `409 GRAFT_HAS_CONTINUATIONS`;
- `413 GRAFT_TOO_LARGE`;
- `429 GRAFT_RATE_LIMITED`.

The client retains the graph selection after recoverable errors so the user can refresh the preview
without rebuilding the selection.

## 17. Client Architecture

Focused modules:

- `client/src/components/SidePanel/Tree/ConversationTreePanel.tsx`
- `client/src/components/Chat/Tree/ConversationTreeDialog.tsx`
- `client/src/components/Chat/Tree/ConversationTreeCanvas.tsx`
- `client/src/components/Chat/Tree/ConversationTreeNode.tsx`
- `client/src/components/Chat/Tree/ConversationTreeInspector.tsx`
- `client/src/components/Chat/Tree/ConversationTreeMiniMap.tsx`
- `client/src/components/Chat/Tree/GraftBridgeCard.tsx`
- `client/src/components/Chat/Tree/useConversationTreeLayout.ts`
- `client/src/components/Chat/Tree/useGenerationGraft.ts`

The graph derives from the existing message query and tree builder. Server state is not duplicated in
a second client-side graph store.

Ephemeral UI state includes viewport, zoom, orientation, collapsed nodes, focus, source,
destination, copy mode, and preview state.

## 18. Backend Architecture

Focused modules:

- `api/server/services/MessageGrafts/index.js`
- `api/server/services/MessageGrafts/graph.js`
- `api/server/services/MessageGrafts/clone.js`
- `api/server/services/MessageGrafts/revision.js`
- graft routes in `api/server/routes/messages.js`
- data-provider request and response types;
- client data-service, query, and mutation hooks.

The existing message schema's mixed `metadata` field avoids a data migration.

## 19. Accessibility

The feature must provide:

- visible focus indicators;
- keyboard-complete source and destination selection;
- screen-reader labels containing role, generation number, sender/model, state, and excerpt;
- announcements when graft mode starts, a valid target is focused, preview is ready, graft succeeds,
  or undo succeeds;
- no color-only distinction;
- reduced-motion behavior;
- the hierarchical list alternative.

## 20. Performance

The client:

- memoizes graph normalization and layout;
- renders only expanded nodes;
- uses SVG paths for edges and HTML nodes in one transformed viewport layer;
- throttles pointer-move and mini-map updates with animation frames;
- avoids re-layout during ordinary pan and zoom;
- keeps layout work bounded by the visible node count;
- warns before expanding very large trees.

The backend:

- loads only the authenticated conversation's required fields for preview;
- bulk-loads tool calls for copied message IDs;
- uses bulk inserts;
- verifies with graft-ID-scoped queries.

## 21. Testing

### 21.1 Backend

Tests cover:

- generation-only graft;
- full-subtree graft;
- source preserved;
- parent ID remapping;
- bridge role and fixed text;
- complete-to-complete, partial-to-complete, complete-to-partial, and partial-to-partial pairings;
- stopped, aborted, and errored partial-state preservation;
- active source stop-and-graft flow;
- active destination stop-and-graft flow;
- wait-for-completion flow with retained selection;
- rejection of browser-only transient snapshots;
- attachment message-ID remapping;
- tool-call cloning;
- active-leaf mapping;
- ownership enforcement;
- unstabilized active-generation rejection while stable partial generations remain supported;
- ancestor/descendant overlap rejection;
- stale revision rejection;
- idempotent retry;
- oversize rejection;
- compensating cleanup;
- undo without continuations;
- guarded undo with continuations.

### 21.2 Client

Tests cover:

- deterministic graph layout;
- fit calculations;
- semantic zoom detail;
- active-branch expansion;
- collapse persistence;
- hidden-descendant badges;
- drag source and valid target highlighting;
- invalid target reasons;
- complete and partial node-state badges;
- active-stream stabilization dialog;
- retained drag selection while waiting for completion;
- edge auto-pan;
- drop opening preview without mutation;
- server preview gating confirmation;
- keyboard selection;
- mobile tap workflow;
- mini-map navigation;
- successful graft query invalidation and focus;
- bridge card rendering;
- immediate and guarded undo.

### 21.3 Browser validation

Use a synthetic dev account and conversation to validate:

1. create two sibling generations;
2. open the graph;
3. drag Generation 2 onto Generation 1;
4. confirm generation-only preview;
5. continue from the grafted copy;
6. undo the graft and continuation;
7. repeat all four complete/partial source and destination pairings;
8. repeat while the source is actively streaming using Stop and graft;
9. repeat while the destination is actively streaming using Wait for it to finish;
10. repeat with a subtree containing tools, files, and an image;
11. resize desktop and mobile viewports;
12. verify zoom, pan, mini-map, collapse, fit, keyboard, and touch-equivalent controls;
13. confirm original branches are unchanged.

## 22. Documentation

Implementation updates:

- `CUSTOMIZATION_MASTER_DOC.md`;
- `CUSTOMIZATION_MASTER_GUIDE.md`;
- a focused `GENERATION_TREE_GRAFTING.md` operator and user guide;
- deployment/build notes when new validation commands are added.

Documentation must identify the feature as part of the protected customization surface.

## 23. Deployment

Development and browser validation occur away from production.

Frontend source changes require:

1. relevant unit tests;
2. a full client build;
3. manifest verification;
4. `deploy-built-client-dist.sh`.

Backend runtime changes use the guarded runtime-delta path when accepted by classification.

Before production promotion:

- all graft tests pass;
- existing fork, generation deletion, usage, memory, image, auth, and reasoning-preservation tests
  pass;
- auth, memory, reasoning, runtime-command, and memory-headroom verifiers pass;
- production is healthy and no protected conversation is actively generating;
- the exact deployment is explicitly approved.

After promotion, repeat the synthetic browser flow and verify production health, session
persistence, retry/new-chat behavior, existing forks, generation deletion, and undo.

## 24. Acceptance Criteria

The feature is complete when:

1. a user can drag one completed sibling generation onto another;
2. no mutation occurs until the preview is confirmed;
3. the original source remains unchanged;
4. the copied generation appears beneath a compact graft bridge;
5. future model calls include both destination and copied source context in valid role order;
6. every complete/partial source and destination pairing works;
7. actively streaming selections can be stopped and grafted or awaited without using transient
   browser-only text;
8. generation-only and complete-subtree modes work;
9. tools, attachments, files, and images remain visible without being rerun;
10. the graph fits the viewport and supports pan, zoom, mini-map, search, focus, and orientation;
11. branches expand and collapse predictably;
12. mouse, touch-equivalent, and keyboard workflows work;
13. the graft is visibly traceable to its source;
14. undo is immediate when safe and explicitly guarded when continuations exist;
15. stale, overlapping, unauthorized, duplicate, and oversized operations are rejected;
16. active operations require explicit stabilization or waiting;
17. all focused and preservation tests pass;
18. documentation is current;
19. the guarded production deployment and live validation pass.
