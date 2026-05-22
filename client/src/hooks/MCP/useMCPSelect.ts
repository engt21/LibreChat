import { useCallback, useEffect, useMemo } from 'react';
import { useAtom } from 'jotai';
import isEqual from 'lodash/isEqual';
import { useRecoilState } from 'recoil';
import { Constants, LocalStorageKeys, type TEphemeralAgent } from 'librechat-data-provider';
import {
  ephemeralAgentByConvoId,
  mcpValuesAtomFamily,
  mcpPinnedAtom,
  mcpToolFilterAtomFamily,
} from '~/store';
import { setTimestamp } from '~/utils/timestamps';
import { MCPServerDefinition } from './useMCPServerManager';

type MCPToolFilter = Record<string, string[]>;

function normalizeToolKeys(value: string[]) {
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
}

function pruneToolFilter(filter: MCPToolFilter, selectedServers: string[]) {
  const selectedSet = new Set(selectedServers);
  return Object.fromEntries(
    Object.entries(filter)
      .filter(([serverName, toolKeys]) => selectedSet.has(serverName) && Array.isArray(toolKeys))
      .map(([serverName, toolKeys]) => [serverName, normalizeToolKeys(toolKeys)] as const)
      .filter(([, toolKeys]) => toolKeys.length > 0),
  );
}

function normalizeExternalToolFilter(
  value: unknown,
  selectedServers: string[],
  configuredServers: Set<string>,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const selectedSet = new Set(selectedServers);
  return Object.fromEntries(
    Object.entries(value as MCPToolFilter)
      .filter(
        ([serverName, toolKeys]) =>
          selectedSet.has(serverName) &&
          configuredServers.has(serverName) &&
          Array.isArray(toolKeys),
      )
      .map(([serverName, toolKeys]) => [serverName, normalizeToolKeys(toolKeys)] as const)
      .filter(([, toolKeys]) => toolKeys.length > 0),
  );
}

function buildEphemeralAgentUpdate(
  prev: TEphemeralAgent | null | undefined,
  mcp: string[],
  mcpToolFilter: MCPToolFilter,
) {
  const next: TEphemeralAgent = { ...(prev ?? {}), mcp };
  if (Object.keys(mcpToolFilter).length > 0) {
    next.mcpToolFilter = mcpToolFilter;
  } else {
    delete next.mcpToolFilter;
  }
  return next;
}

export function useMCPSelect({
  conversationId,
  storageContextKey,
  servers,
}: {
  conversationId?: string | null;
  storageContextKey?: string;
  servers: MCPServerDefinition[];
}) {
  const key = conversationId ?? Constants.NEW_CONVO;
  const configuredServers = useMemo(() => {
    return new Set(servers?.map((s) => s.serverName));
  }, [servers]);

  /**
   * For new conversations, key the MCP atom by environment (spec or defaults)
   * so switching between spec ↔ non-spec gives each its own atom.
   * For existing conversations, key by conversation ID for per-conversation isolation.
   */
  const isNewConvo = key === Constants.NEW_CONVO;
  const mcpAtomKey = isNewConvo && storageContextKey ? storageContextKey : key;

  const [isPinned, setIsPinned] = useAtom(mcpPinnedAtom);
  const [mcpValues, setMCPValuesRaw] = useAtom(mcpValuesAtomFamily(mcpAtomKey));
  const [mcpToolFilter, setMCPToolFilterRaw] = useAtom(mcpToolFilterAtomFamily(mcpAtomKey));
  const [ephemeralAgent, setEphemeralAgent] = useRecoilState(ephemeralAgentByConvoId(key));

  // Sync ephemeral agent MCP → Jotai atom (strip unconfigured servers)
  useEffect(() => {
    const mcps = ephemeralAgent?.mcp;
    if (Array.isArray(mcps) && mcps.length > 0 && configuredServers.size > 0) {
      const activeMcps = mcps.filter((mcp) => configuredServers.has(mcp));
      if (!isEqual(activeMcps, mcpValues)) {
        setMCPValuesRaw(activeMcps);
      }
      const activeToolFilter = normalizeExternalToolFilter(
        ephemeralAgent?.mcpToolFilter,
        activeMcps,
        configuredServers,
      );
      if (!isEqual(activeToolFilter, mcpToolFilter)) {
        setMCPToolFilterRaw(activeToolFilter);
      }
    } else if (
      Array.isArray(mcps) &&
      mcps.length === 0 &&
      (mcpValues.length > 0 || Object.keys(mcpToolFilter).length > 0)
    ) {
      // Ephemeral agent explicitly has empty MCP (e.g., spec with no MCP servers) — clear atom
      setMCPValuesRaw([]);
      setMCPToolFilterRaw({});
    }
  }, [
    ephemeralAgent?.mcp,
    ephemeralAgent?.mcpToolFilter,
    setMCPValuesRaw,
    setMCPToolFilterRaw,
    configuredServers,
    mcpValues,
    mcpToolFilter,
  ]);

  // Write timestamp when MCP values change
  useEffect(() => {
    const mcpStorageKey = `${LocalStorageKeys.LAST_MCP_}${mcpAtomKey}`;
    if (mcpValues.length > 0) {
      setTimestamp(mcpStorageKey);
    }
  }, [mcpValues, mcpToolFilter, mcpAtomKey]);

  const commitMCPSelection = useCallback(
    (values: string[], toolFilter: MCPToolFilter) => {
      const normalizedValues = normalizeToolKeys(values);
      const normalizedToolFilter = pruneToolFilter(toolFilter, normalizedValues);
      setMCPValuesRaw(normalizedValues);
      setMCPToolFilterRaw(normalizedToolFilter);
      setEphemeralAgent((prev) => {
        const next = buildEphemeralAgentUpdate(prev, normalizedValues, normalizedToolFilter);
        if (
          !isEqual(prev?.mcp, normalizedValues) ||
          !isEqual(prev?.mcpToolFilter, next.mcpToolFilter)
        ) {
          return next;
        }
        return prev;
      });

      if (storageContextKey) {
        const envKey = `${LocalStorageKeys.LAST_MCP_}${storageContextKey}`;
        const envToolFilterKey = `${LocalStorageKeys.LAST_MCP_TOOL_FILTER_}${storageContextKey}`;
        localStorage.setItem(envKey, JSON.stringify(normalizedValues));
        localStorage.setItem(envToolFilterKey, JSON.stringify(normalizedToolFilter));
        setTimestamp(envKey);
      }
    },
    [setMCPValuesRaw, setMCPToolFilterRaw, setEphemeralAgent, storageContextKey],
  );

  /** Stable memoized setter with dual-write to environment key */
  const setMCPValues = useCallback(
    (value: string[]) => {
      if (!Array.isArray(value)) {
        return;
      }
      commitMCPSelection(value, pruneToolFilter(mcpToolFilter, value));
    },
    [commitMCPSelection, mcpToolFilter],
  );

  const setServerToolSelection = useCallback(
    (serverName: string, selectedToolKeys: string[], allToolKeys: string[]) => {
      const normalizedSelected = normalizeToolKeys(selectedToolKeys);
      const normalizedAll = normalizeToolKeys(allToolKeys);
      const currentValues = mcpValues ?? [];
      let nextValues = currentValues.includes(serverName)
        ? currentValues
        : [...currentValues, serverName];
      const nextFilter = { ...pruneToolFilter(mcpToolFilter, nextValues) };

      if (normalizedSelected.length === 0) {
        nextValues = currentValues.filter((name) => name !== serverName);
        delete nextFilter[serverName];
      } else if (
        normalizedAll.length > 0 &&
        normalizedSelected.length === normalizedAll.length &&
        normalizedAll.every((toolKey) => normalizedSelected.includes(toolKey))
      ) {
        delete nextFilter[serverName];
      } else {
        nextFilter[serverName] = normalizedSelected;
      }

      commitMCPSelection(nextValues, nextFilter);
    },
    [commitMCPSelection, mcpToolFilter, mcpValues],
  );

  return {
    isPinned,
    mcpValues,
    mcpToolFilter,
    setIsPinned,
    setMCPValues,
    setServerToolSelection,
  };
}
