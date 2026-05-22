import { atom } from 'jotai';
import { atomFamily, atomWithStorage } from 'jotai/utils';
import { Constants, LocalStorageKeys } from 'librechat-data-provider';
import { createTabIsolatedStorage } from './jotai-utils';

/**
 * Tab-isolated storage for MCP values — prevents cross-tab sync so that
 * each tab's MCP server selections are independent (especially for new chats
 * which all share the same `LAST_MCP_new` localStorage key).
 */
const mcpTabIsolatedStorage = createTabIsolatedStorage<string[]>();
const mcpToolFilterTabIsolatedStorage = createTabIsolatedStorage<Record<string, string[]>>();

/**
 * Creates a storage atom for MCP values per conversation
 * Uses atomFamily to create unique atoms for each conversation ID
 */
export const mcpValuesAtomFamily = atomFamily((conversationId: string | null) => {
  const key = conversationId ?? Constants.NEW_CONVO;
  const storageKey = `${LocalStorageKeys.LAST_MCP_}${key}`;

  return atomWithStorage<string[]>(storageKey, [], mcpTabIsolatedStorage, { getOnInit: true });
});

/**
 * Creates a storage atom for per-server MCP tool filters per conversation.
 * Missing server keys mean all tools are selected for that server.
 */
export const mcpToolFilterAtomFamily = atomFamily((conversationId: string | null) => {
  const key = conversationId ?? Constants.NEW_CONVO;
  const storageKey = `${LocalStorageKeys.LAST_MCP_TOOL_FILTER_}${key}`;

  return atomWithStorage<Record<string, string[]>>(
    storageKey,
    {},
    mcpToolFilterTabIsolatedStorage,
    {
      getOnInit: true,
    },
  );
});

/**
 * Global storage atom for MCP pinned state (shared across all conversations)
 */
export const mcpPinnedAtom = atomWithStorage<boolean>(LocalStorageKeys.PIN_MCP_, true, undefined, {
  getOnInit: true,
});

/**
 * Server initialization state - shared globally so chat dropdown and settings panel
 * both see the same OAuth/initialization state.
 *
 * This enables canceling OAuth from either location.
 */
export interface MCPServerInitState {
  isInitializing: boolean;
  isCancellable: boolean;
  oauthUrl: string | null;
  oauthStartTime: number | null;
}

const defaultServerInitState: MCPServerInitState = {
  isInitializing: false,
  isCancellable: false,
  oauthUrl: null,
  oauthStartTime: null,
};

/**
 * Global atom for MCP server initialization states.
 * Keyed by server name.
 */
export const mcpServerInitStatesAtom = atom<Record<string, MCPServerInitState>>({});

/**
 * Helper to get or create a server's init state
 */
export const getServerInitState = (
  states: Record<string, MCPServerInitState>,
  serverName: string,
): MCPServerInitState => {
  return states[serverName] || defaultServerInitState;
};
