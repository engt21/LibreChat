import { useEffect, useRef } from 'react';
import type { MCPConnectionStatusResponse } from 'librechat-data-provider';
import type { MCPServerDefinition } from './useMCPServerManager';

/**
 * Auto-connects disconnected non-OAuth MCP servers on mount.
 * Does NOT add connected servers to the chat selection (autoSelect=false).
 */
export function useAutoConnectMCP({
  servers,
  connectionStatus,
  isLoading,
  initializeServer,
  isInitializing,
}: {
  servers: MCPServerDefinition[];
  connectionStatus: MCPConnectionStatusResponse['connectionStatus'] | undefined;
  isLoading: boolean;
  initializeServer: (serverName: string, autoOpenOAuth?: boolean, autoSelect?: boolean) => Promise<unknown>;
  isInitializing: (serverName: string) => boolean;
}) {
  const hasRun = useRef(false);

  useEffect(() => {
    if (isLoading || !connectionStatus || !servers.length || hasRun.current) {
      return;
    }
    hasRun.current = true;

    for (const server of servers) {
      const status = connectionStatus[server.serverName];
      const state = status?.connectionState;

      // Skip servers already connected, connecting, or being initialized
      if (state === 'connected' || state === 'connecting' || isInitializing(server.serverName)) {
        continue;
      }

      // Skip OAuth-required servers (user must manually auth)
      if (status?.requiresOAuth) {
        continue;
      }

      // Auto-connect: don't open OAuth popups, don't select for chat
      initializeServer(server.serverName, false, false);
    }
  }, [servers, connectionStatus, isLoading, initializeServer, isInitializing]);
}
