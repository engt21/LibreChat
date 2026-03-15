import React from 'react';
import * as Ariakit from '@ariakit/react';
import { Globe, ChevronRight, Settings } from 'lucide-react';
import { PinIcon } from '@librechat/client';
import { WebSearchModes } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type WebSearchMode = WebSearchModes | string | false;

interface WebSearchSubMenuProps {
  currentMode: WebSearchMode;
  enabled: boolean;
  isPinned: boolean;
  setIsPinned: (value: boolean) => void;
  showSettings: boolean;
  menuTriggerRef?: React.RefObject<HTMLButtonElement>;
  onToggle: () => void;
  onOpenSettings: () => void;
  onSelectMode: (mode: WebSearchModes) => void;
}

const modeLabels: Record<WebSearchModes, string> = {
  [WebSearchModes.librechat]: 'LibreChat',
  [WebSearchModes.ollama_native]: 'Ollama native',
  [WebSearchModes.ollama_mcp]: 'Ollama MCP',
};

const getModeDescription = (mode: WebSearchModes) => {
  if (mode === WebSearchModes.librechat) {
    return 'Use LibreChat search providers.';
  }

  if (mode === WebSearchModes.ollama_native) {
    return 'Expose Ollama hosted web_search and web_fetch directly.';
  }

  return 'Route Ollama web_search and web_fetch through a hidden MCP server.';
};

const WebSearchSubMenu = React.forwardRef<HTMLDivElement, WebSearchSubMenuProps>(
  (
    {
      currentMode,
      enabled,
      isPinned,
      setIsPinned,
      showSettings,
      menuTriggerRef,
      onToggle,
      onOpenSettings,
      onSelectMode,
      ...props
    },
    ref,
  ) => {
    const localize = useLocalize();
    const menuStore = Ariakit.useMenuStore({
      focusLoop: true,
      showTimeout: 100,
      placement: 'right',
    });

    const activeMode = (currentMode || WebSearchModes.ollama_native) as WebSearchModes;
    const helperText = enabled
      ? 'Choose how LibreChat wires web tools for this Ollama chat.'
      : 'Pick the Ollama web-search mode, then enable web search.';
    const apiKeyHint =
      'Ollama native and MCP modes require `OLLAMA_API_KEY` on the LibreChat server.';

    return (
      <div ref={ref}>
        <Ariakit.MenuProvider store={menuStore}>
          <Ariakit.MenuItem
            {...props}
            hideOnClick={false}
            render={
              <Ariakit.MenuButton
                onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  onToggle();
                }}
                onMouseEnter={() => {
                  menuStore.show();
                }}
                className="flex w-full cursor-pointer items-center justify-between rounded-lg p-2 hover:bg-surface-hover"
              />
            }
          >
            <div className="flex items-center gap-2">
              <Globe className="icon-md" aria-hidden="true" />
              <span>{localize('com_ui_web_search')}</span>
              <ChevronRight className="ml-auto h-3 w-3" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-1">
              {showSettings && activeMode === WebSearchModes.librechat && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenSettings();
                  }}
                  className={cn(
                    'rounded p-1 transition-all duration-200',
                    'hover:bg-surface-tertiary hover:shadow-sm',
                    'text-text-secondary hover:text-text-primary',
                  )}
                  aria-label="Configure web search"
                  ref={menuTriggerRef}
                >
                  <div className="h-4 w-4">
                    <Settings className="h-4 w-4" aria-hidden="true" />
                  </div>
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPinned(!isPinned);
                }}
                className={cn(
                  'rounded p-1 transition-all duration-200',
                  'hover:bg-surface-tertiary hover:shadow-sm',
                  !isPinned && 'text-text-secondary hover:text-text-primary',
                )}
                aria-label={isPinned ? localize('com_ui_unpin') : localize('com_ui_pin')}
              >
                <div className="h-4 w-4">
                  <PinIcon unpin={isPinned} />
                </div>
              </button>
            </div>
          </Ariakit.MenuItem>

          <Ariakit.Menu
            portal={true}
            unmountOnHide={true}
            className={cn(
              'animate-popover-left z-40 ml-3 flex min-w-[280px] flex-col rounded-xl',
              'border border-border-light bg-presentation p-1.5 shadow-lg',
            )}
          >
            <div className="px-2 py-1 text-xs text-text-secondary">{helperText}</div>
            {Object.values(WebSearchModes).map((mode) => (
              <Ariakit.MenuItem
                key={mode}
                hideOnClick={false}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectMode(mode);
                }}
                className={cn(
                  'mb-1 flex items-center justify-between gap-2 rounded-lg px-2 py-2',
                  'cursor-pointer bg-surface-secondary text-text-primary outline-none transition-colors',
                  'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
                  activeMode === mode && 'bg-surface-active',
                )}
              >
                <div className="flex flex-col">
                  <span className="text-sm">{modeLabels[mode]}</span>
                  <span className="text-xs text-text-secondary">{getModeDescription(mode)}</span>
                </div>
                <Ariakit.MenuItemCheck checked={activeMode === mode} />
              </Ariakit.MenuItem>
            ))}
            <div className="px-2 pb-1 pt-0.5 text-[11px] text-text-secondary">{apiKeyHint}</div>
          </Ariakit.Menu>
        </Ariakit.MenuProvider>
      </div>
    );
  },
);

WebSearchSubMenu.displayName = 'WebSearchSubMenu';

export default React.memo(WebSearchSubMenu);
