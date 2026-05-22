import { useMemo, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Check, ChevronDown } from 'lucide-react';
import { MCPIcon } from '@librechat/client';
import type { MCPTool } from 'librechat-data-provider';
import type { MCPServerDefinition } from '~/hooks/MCP/useMCPServerManager';
import type { MCPServerStatusIconProps } from './MCPServerStatusIcon';
import MCPServerStatusIcon from './MCPServerStatusIcon';
import {
  getStatusColor,
  getStatusTextKey,
  shouldShowActionButton,
  type ConnectionStatusMap,
} from './mcpServerUtils';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MCPServerMenuItemProps {
  server: MCPServerDefinition;
  isSelected: boolean;
  connectionStatus?: ConnectionStatusMap;
  isInitializing?: (serverName: string) => boolean;
  statusIconProps?: MCPServerStatusIconProps | null;
  tools?: MCPTool[];
  mcpToolFilter?: Record<string, string[]>;
  onToggle: (serverName: string) => void;
  onToolSelectionChange?: (
    serverName: string,
    selectedToolKeys: string[],
    allToolKeys: string[],
  ) => void;
}

export default function MCPServerMenuItem({
  server,
  isSelected,
  connectionStatus,
  isInitializing,
  statusIconProps,
  tools = [],
  mcpToolFilter = {},
  onToggle,
  onToolSelectionChange,
}: MCPServerMenuItemProps) {
  const localize = useLocalize();
  const [isExpanded, setIsExpanded] = useState(false);
  const displayName = server.config?.title || server.serverName;
  const statusColor = getStatusColor(server.serverName, connectionStatus, isInitializing);
  const statusTextKey = getStatusTextKey(server.serverName, connectionStatus, isInitializing);
  const statusText = localize(statusTextKey as Parameters<typeof localize>[0]);
  const showActionButton = shouldShowActionButton(statusIconProps);
  const sortedTools = useMemo(
    () => [...tools].sort((left, right) => left.name.localeCompare(right.name)),
    [tools],
  );
  const allToolKeys = useMemo(() => sortedTools.map((tool) => tool.pluginKey), [sortedTools]);
  const configuredToolFilter = mcpToolFilter[server.serverName];
  const selectedToolKeys = useMemo(() => {
    if (!isSelected) {
      return [];
    }

    if (Array.isArray(configuredToolFilter)) {
      const availableToolKeys = new Set(allToolKeys);
      return configuredToolFilter.filter((toolKey) => availableToolKeys.has(toolKey));
    }

    return allToolKeys;
  }, [allToolKeys, configuredToolFilter, isSelected]);
  const selectedToolKeySet = useMemo(() => new Set(selectedToolKeys), [selectedToolKeys]);
  const canSelectTools = sortedTools.length > 0 && onToolSelectionChange != null;
  const toolSummary = useMemo(() => {
    if (!isSelected || allToolKeys.length === 0) {
      return null;
    }

    if (selectedToolKeys.length === allToolKeys.length) {
      return localize('com_ui_mcp_all_tools');
    }

    return localize('com_ui_mcp_selected_tools', {
      selected: selectedToolKeys.length,
      total: allToolKeys.length,
    });
  }, [allToolKeys.length, isSelected, localize, selectedToolKeys.length]);

  const handleToolToggle = (toolKey: string) => {
    if (!onToolSelectionChange) {
      return;
    }

    const nextSelected = new Set(selectedToolKeys);
    if (nextSelected.has(toolKey)) {
      nextSelected.delete(toolKey);
    } else {
      nextSelected.add(toolKey);
    }

    onToolSelectionChange(server.serverName, Array.from(nextSelected), allToolKeys);
  };

  // Include status in aria-label so screen readers announce it
  const accessibleLabel = `${displayName}, ${statusText}`;

  return (
    <div>
      <Ariakit.MenuItemCheckbox
        hideOnClick={false}
        name="mcp-servers"
        value={server.serverName}
        checked={isSelected}
        onChange={() => onToggle(server.serverName)}
        aria-label={accessibleLabel}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2',
          'outline-none transition-all duration-150',
          'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
          isSelected && 'bg-surface-active-alt',
        )}
      >
        {canSelectTools && (
          <button
            type="button"
            aria-label={localize('com_ui_mcp_expand_tools', { 0: displayName })}
            aria-expanded={isExpanded}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-surface-tertiary"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsExpanded((current) => !current);
            }}
          >
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')}
            />
          </button>
        )}

        {/* Server Icon with Status Dot */}
        <div className="relative flex-shrink-0">
          {server.config?.iconPath ? (
            <img
              src={server.config.iconPath}
              className="h-8 w-8 rounded-lg object-cover"
              alt={displayName}
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary">
              <MCPIcon className="h-5 w-5 text-text-secondary" />
            </div>
          )}
          {/* Status dot - decorative, status is announced via aria-label on MenuItem */}
          <div
            aria-hidden="true"
            className={cn(
              'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-secondary',
              statusColor,
            )}
          />
        </div>

        {/* Server Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-text-primary">{displayName}</span>
          </div>
          {server.config?.description && (
            <p className="truncate text-xs text-text-secondary">{server.config.description}</p>
          )}
          {toolSummary && <p className="truncate text-xs text-text-secondary">{toolSummary}</p>}
        </div>

        {/* Action Button - only show when actionable */}
        {showActionButton && statusIconProps && (
          <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <MCPServerStatusIcon {...statusIconProps} />
          </div>
        )}

        {/* Selection Indicator - purely visual, state conveyed by aria-checked on MenuItem */}
        <span
          aria-hidden="true"
          className={cn(
            'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border',
            isSelected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border-xheavy bg-transparent',
          )}
        >
          {isSelected && <Check className="h-4 w-4" />}
        </span>
      </Ariakit.MenuItemCheckbox>

      {canSelectTools && isExpanded && (
        <div className="ml-10 mt-1 space-y-1 border-l border-border-light pl-2">
          {sortedTools.map((tool) => (
            <Ariakit.MenuItemCheckbox
              key={tool.pluginKey}
              hideOnClick={false}
              name={`mcp-tools-${server.serverName}`}
              value={tool.pluginKey}
              checked={selectedToolKeySet.has(tool.pluginKey)}
              onChange={() => handleToolToggle(tool.pluginKey)}
              className={cn(
                'flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5',
                'text-left text-xs outline-none transition-colors',
                'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-sm border',
                  selectedToolKeySet.has(tool.pluginKey)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border-xheavy bg-transparent',
                )}
              >
                {selectedToolKeySet.has(tool.pluginKey) && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-text-primary">{tool.name}</span>
                {tool.description ? (
                  <span className="line-clamp-2 text-text-secondary">{tool.description}</span>
                ) : null}
              </span>
            </Ariakit.MenuItemCheckbox>
          ))}
        </div>
      )}
    </div>
  );
}
