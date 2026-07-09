# Generation Tree Branch Appending

LibreChat's conversation tree can copy one assistant response or an entire later
branch and append it after another assistant response. The original branch is
not moved or changed.

The interface uses **append** for the user-facing action. The API, persistence
records, and internal code continue to use **generation graft**.

## Quick Phone Flow

1. Open a message menu and choose **Append response or branch**, or open the
   conversation tree and choose **How to append**.
2. Tap the first assistant response in the branch to copy.
3. Choose **Use as source** in the mobile action bar.
4. Tap the final assistant response in the branch that should come first.
5. Choose **Append here**. The review sheet opens with an initial preview.
6. Choose the scope:
   - **Only this response** copies one assistant answer.
   - **Whole branch from here** copies that answer and every later message below
     it.
7. If the scope changed, choose **Preview append**. Review the authoritative
   copied-message and artifact counts, then choose **Append branch**.

Nothing is written until **Append branch** is confirmed.

## Example: Put the Full 2 of 2 Thread After 1 of 2

To append an entire Generation 2 of 2 branch to the very end of a complete
Generation 1 of 2 branch:

1. Tap the first assistant response labeled **Generation 2 of 2**.
2. Choose **Use as source**.
3. Follow the Generation 1 of 2 branch to its final assistant response and tap
   that response.
4. Choose **Append here**.
5. Select **Whole branch from here**.
6. Choose **Preview append**, verify the counts, and choose **Append branch**.

LibreChat copies the full Generation 2 of 2 branch after the selected final
Generation 1 of 2 response. The original Generation 2 of 2 branch remains
available in its original location. After creation, the transcript switches to
the newly appended branch immediately.

## Guided and Advanced Controls

- Normal taps drive the guided source and destination workflow on phones and
  desktop.
- Assistant nodes are labeled **Generation X of Y** when several generations
  share the same prompt. This distinguishes branches without relying on message
  IDs or icon meanings.
- The tree toolbar uses visible labels and horizontally scrolls on narrow
  screens.
- **Browse list** provides a compact keyboard-friendly representation. Space
  selects a source, Enter selects a destination, and Escape cancels.
- Streaming responses selected from **Browse list** enter the same stop-or-wait
  stabilization flow as the guided controls.
- The **Append** handle on a node supports drag and drop for experienced desktop
  users. It opens the same server-backed preview as the guided flow.
- **How to append** opens an in-app help page with the guided steps, the 2 of 2
  example, drag and keyboard controls, and undo behavior.
- After a successful append, LibreChat selects the copied branch at every
  ancestor generation so the newly appended transcript is visible even when the
  destination started on a non-active sibling.

## Validation and Safety

- Source and destination must be assistant responses in the same conversation.
- A source cannot be appended into itself or its own copied branch.
- Complete, stopped partial, aborted partial, and errored partial responses can
  be appended. An actively streaming response must finish or be stopped before
  the preview can complete.
- Preview counts and warnings come from the server and are the authority for
  create eligibility.
- Create retries remain idempotent for the same source, destination, scope,
  active leaf, and tree revision.
- The 10-second **Undo** action removes the copied branch. If later messages
  continue from the copy, LibreChat requires an explicit destructive
  confirmation before deleting them.

## Key Files

- `client/src/components/Chat/Tree/ConversationTreeDialog.tsx`
- `client/src/components/Chat/Tree/ConversationTreeInspector.tsx`
- `client/src/components/Chat/Tree/ConversationTreeSelectionGuide.tsx`
- `client/src/components/Chat/Tree/ConversationTreeMobileGuideBar.tsx`
- `client/src/components/Chat/Tree/ConversationTreeHelp.tsx`
- `client/src/components/Chat/Tree/ConversationTreeNode.tsx`
- `client/src/components/Chat/Tree/ConversationTreeToolbar.tsx`
- `client/src/components/Chat/Tree/treeLabels.ts`
- `client/src/components/Chat/Tree/useGenerationGraft.ts`
- `client/src/hooks/Chat/useChatHelpers.ts`
- `client/src/hooks/Messages/messageBranchSelection.ts`
- `client/src/locales/en/translation.json`
- `e2e/specs/generation-tree-grafting.spec.ts`

Setting only the latest message is not sufficient after an append. Recoil keeps
one sibling selection per ancestor, so every selector along the copied
message's ancestry must be updated or the transcript can remain on the original
branch while the tree focuses the copy.

## Deployment

This is a frontend customization. Build the complete client distribution and
promote it through the manifest-verified client deployment workflow. Never copy
individual source or hashed asset files into a running container.

Production promotion is a separate maintenance action and requires explicit
approval after focused tests, the full client build, and real-browser validation
on the dev rail pass.

The full serial Playwright matrix performs enough create and undo operations to
approach the one-minute graft mutation limit. Start a full validation run after
a fresh isolated-dev API restart or a completed limiter window. The E2E helper
checks the create response status explicitly so an HTTP 429 is reported as rate
limiting rather than as a missing transcript card.
