import React from 'react';
import { SettingsIcon } from 'lucide-react';
import { EModelEndpoint, isAgentsEndpoint } from 'librechat-data-provider';
import type { Endpoint } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface EndpointSettingsButtonProps {
  endpoint: Endpoint;
  className?: string;
  tabIndex?: number;
  showTextOnHover?: boolean;
  handleOpenKeyDialog: (
    endpoint: EModelEndpoint,
    e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
  ) => void;
}

export const canShowEndpointSettingsButton = (endpoint: Endpoint) =>
  Boolean(endpoint.value) && !isAgentsEndpoint(endpoint.value);

export function EndpointSettingsButton({
  endpoint,
  className,
  tabIndex,
  showTextOnHover = true,
  handleOpenKeyDialog,
}: EndpointSettingsButtonProps) {
  const localize = useLocalize();
  const text = localize('com_endpoint_config_key');

  const openDialog = (e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    if (!endpoint.value) {
      return;
    }

    e.stopPropagation();
    handleOpenKeyDialog(endpoint.value as EModelEndpoint, e);
  };

  return (
    <button
      type="button"
      tabIndex={tabIndex}
      onClick={openDialog}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDialog(e);
        }
      }}
      className={cn(
        'group/button flex items-center gap-1.5 rounded-md px-1.5',
        'text-text-secondary transition-colors duration-150',
        'hover:bg-surface-tertiary hover:text-text-primary',
        'focus-visible:bg-surface-tertiary focus-visible:text-text-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        className,
      )}
      aria-label={`${text} ${endpoint.label}`}
    >
      <SettingsIcon className="size-4 shrink-0" aria-hidden="true" />
      {showTextOnHover && (
        <span
          aria-hidden="true"
          className={cn(
            'grid overflow-hidden transition-[grid-template-columns,opacity] duration-150 ease-out',
            'grid-cols-[0fr] opacity-0',
            'group-hover/button:grid-cols-[1fr] group-hover/button:opacity-100',
            'group-focus-visible/button:grid-cols-[1fr] group-focus-visible/button:opacity-100',
          )}
        >
          <span className="min-w-0 truncate pr-0.5">{text}</span>
        </span>
      )}
    </button>
  );
}
