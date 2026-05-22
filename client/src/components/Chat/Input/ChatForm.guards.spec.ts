/**
 * REGRESSION GUARDS for ChatForm.tsx super-admin gating.
 *
 * On 2026-04-11, BadgeRow was incorrectly wrapped in `{!isSuperAdmin && (<BadgeRow .../>)}`
 * under the (incorrect) belief that BadgeRow was a model quick-selector. BadgeRow is
 * actually the per-conversation tool-toggle row (Web Search, Code Interpreter, File
 * Search, Artifacts, MCP Servers, and as of 2026-04-26, Image generation + ToolsDropdown
 * menu). That gate hid all per-conversation tool controls from super admins and broke the
 * brand-new Image generation feature for them.
 *
 * The gate was removed on 2026-04-26. This test exists so that any future merge or refactor
 * that reintroduces an `isSuperAdmin` (or equivalent role-based) gate around `<BadgeRow`
 * fails CI immediately.
 *
 * Per-tool permission gating must live INSIDE BadgeRow.tsx (using `useHasAccess` against
 * the user's role) -- not in ChatForm.tsx via a coarse super-admin check.
 */

import * as fs from 'fs';
import * as path from 'path';

const CHAT_FORM_PATH = path.resolve(__dirname, 'ChatForm.tsx');
const USE_TEXTAREA_PATH = path.resolve(__dirname, '../../../hooks/Input/useTextarea.ts');
const USE_SUBMIT_MESSAGE_PATH = path.resolve(
  __dirname,
  '../../../hooks/Messages/useSubmitMessage.ts',
);
const USE_CHAT_HELPERS_PATH = path.resolve(__dirname, '../../../hooks/Chat/useChatHelpers.ts');

describe('ChatForm.tsx -- BadgeRow super-admin gate guard', () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(CHAT_FORM_PATH, 'utf8');
  });

  it('renders <BadgeRow at least once', () => {
    expect(source).toMatch(/<BadgeRow\b/);
  });

  it('does NOT wrap <BadgeRow in an isSuperAdmin gate', () => {
    /**
     * Look for any `isSuperAdmin` (or `!isSuperAdmin`) anywhere in the 1000 chars
     * preceding a `<BadgeRow` JSX tag. A direct gate looks like:
     *   {!isSuperAdmin && (<BadgeRow ...
     *   isSuperAdmin ? null : (<BadgeRow ...
     *   isSuperAdmin ? <Foo/> : <BadgeRow ...
     * If any of those patterns reappear, this test must fail and force the author to
     * relocate the per-tool permission check INTO BadgeRow.tsx where it belongs.
     */
    const badgeRowMatches = [...source.matchAll(/<BadgeRow\b/g)];
    expect(badgeRowMatches.length).toBeGreaterThan(0);

    for (const match of badgeRowMatches) {
      const start = Math.max(0, (match.index ?? 0) - 1000);
      const window = source.slice(start, match.index);

      // forbid both `isSuperAdmin && (` and `!isSuperAdmin && (` style gates
      // and also `isSuperAdmin ? <something> : <BadgeRow` ternary gates
      expect(window).not.toMatch(/!?\bisSuperAdmin\b\s*&&\s*\(\s*$/m);
      expect(window).not.toMatch(/\bisSuperAdmin\b\s*\?\s*[^:]+:\s*$/m);
    }
  });

  it('does NOT import useAdminPermissionsQuery solely to gate BadgeRow', () => {
    /**
     * If a future change reintroduces `useAdminPermissionsQuery` at the top of
     * ChatForm.tsx, fail the test unless the same file ALSO uses the result for a
     * non-BadgeRow purpose (e.g., admin-only buttons elsewhere). This is a softer
     * guard but it catches the most common reintroduction path: someone re-adds the
     * import and copy-pastes the old gate from upstream.
     */
    const importsUseAdminPermissions = /useAdminPermissionsQuery/.test(source);
    if (!importsUseAdminPermissions) {
      return; // nothing to worry about
    }

    // if it IS imported, ensure the result is used for at least one non-BadgeRow node
    const usagesOfIsSuperAdmin = (source.match(/\bisSuperAdmin\b/g) ?? []).length;
    expect(usagesOfIsSuperAdmin).toBeLessThanOrEqual(1);
  });
});

describe('ChatForm.tsx -- model steering input guard', () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(CHAT_FORM_PATH, 'utf8');
  });

  it('does not add a separate steering textarea', () => {
    expect(source).not.toMatch(/\bsteeringText\b/);
    expect(source).not.toMatch(/\bsubmitSteering\b/);
  });

  it('keeps Stop and Send controls available while steering is enabled', () => {
    expect(source).toMatch(/isSubmitting\s*&&\s*showStopButton\s*&&\s*canSteerGeneration/);
    expect(source).toMatch(/<StopButton[\s\S]*<SendButton/);
  });
});

describe('normal chat bar steering guards', () => {
  it('allows Enter to submit while generating when steering is enabled', () => {
    const source = fs.readFileSync(USE_TEXTAREA_PATH, 'utf8');
    expect(source).toMatch(/isSubmitting\s*&&\s*!canSteerGeneration/);
    expect(source).toMatch(/!enterToSend[\s\S]*!canSteerGeneration[\s\S]*insertTextAtCursor/);
  });

  it('routes normal chat submissions to steering when an active generation can be steered', () => {
    const source = fs.readFileSync(USE_SUBMIT_MESSAGE_PATH, 'utf8');
    expect(source).toMatch(/if\s*\(\s*canSteerGeneration\s*\)/);
    expect(source).toMatch(/steerGeneration\(data\.text\)/);
    expect(source).toMatch(/setValue\('text', '', \{ shouldValidate: true \}\)/);
    expect(source).toMatch(/setDraft\(\{ id: `\$\{Constants\.PENDING_CONVO\}`, value: '' \}\)/);
  });

  it('can steer first-message streams once the latest assistant message has a conversation id', () => {
    const source = fs.readFileSync(USE_CHAT_HELPERS_PATH, 'utf8');
    expect(source).toContain('latestMessage?.conversationId');
    expect(source).toContain('currentLatest?.conversationId');
  });
});
