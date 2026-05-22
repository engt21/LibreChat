import { useEffect } from 'react';
import { useRecoilState } from 'recoil';
import TagManager from 'react-gtm-module';
import { LocalStorageKeys } from 'librechat-data-provider';
import type { TStartupConfig, TUser } from 'librechat-data-provider';
import { cleanupTimestampedStorage } from '~/utils/timestamps';
import useSpeechSettingsInit from './useSpeechSettingsInit';
import { useMCPToolsQuery, useMCPServersQuery } from '~/data-provider';
import { useMCPConnectionStatusQuery } from '~/data-provider/Tools/queries';
import { useAutoConnectMCP, useMCPServerManager } from '~/hooks/MCP';
import store from '~/store';

export default function useAppStartup({
  startupConfig,
  user,
}: {
  startupConfig?: TStartupConfig;
  user?: TUser;
}) {
  const [defaultPreset, setDefaultPreset] = useRecoilState(store.defaultPreset);

  useSpeechSettingsInit(!!user);
  const { data: loadedServers, isLoading: serversLoading } = useMCPServersQuery();

  const hasMCPServers = !serversLoading && !!loadedServers && Object.keys(loadedServers).length > 0;

  useMCPToolsQuery({
    enabled: hasMCPServers && !!user,
  });

  const { data: connectionStatusData } = useMCPConnectionStatusQuery({
    enabled: hasMCPServers && !!user,
  });

  const { availableMCPServers, initializeServer, isInitializing } = useMCPServerManager();

  useAutoConnectMCP({
    servers: availableMCPServers,
    connectionStatus: connectionStatusData?.connectionStatus,
    isLoading: serversLoading,
    initializeServer,
    isInitializing,
  });

  /** Clean up old localStorage entries on startup */
  useEffect(() => {
    cleanupTimestampedStorage();
  }, []);

  /** Set the app title */
  useEffect(() => {
    const appTitle = startupConfig?.appTitle ?? '';
    if (!appTitle) {
      return;
    }
    document.title = appTitle;
    localStorage.setItem(LocalStorageKeys.APP_TITLE, appTitle);
  }, [startupConfig]);

  /** Set the default spec's preset as default */
  useEffect(() => {
    if (defaultPreset) {
      return;
    }

    const modelSpecs = startupConfig?.modelSpecs?.list;

    if (!modelSpecs || !modelSpecs.length) {
      return;
    }

    const defaultSpec = modelSpecs.find((spec) => spec.default);

    if (!defaultSpec) {
      return;
    }

    setDefaultPreset({
      ...defaultSpec.preset,
      iconURL: defaultSpec.iconURL,
      spec: defaultSpec.name,
    });
  }, [defaultPreset, setDefaultPreset, startupConfig?.modelSpecs?.list]);

  useEffect(() => {
    if (startupConfig?.analyticsGtmId != null && typeof window.google_tag_manager === 'undefined') {
      const tagManagerArgs = {
        gtmId: startupConfig.analyticsGtmId,
      };
      TagManager.initialize(tagManagerArgs);
    }
  }, [startupConfig?.analyticsGtmId]);
}
