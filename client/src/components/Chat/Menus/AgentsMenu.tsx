import { useCallback, useRef, useState } from 'react';
import { Bot, EarthIcon, LayoutGrid } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Content, Portal, Root, Trigger } from '@radix-ui/react-popover';
import { Button, TooltipAnchor } from '@librechat/client';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type { FC } from 'react';
import {
  useAgentDefaultPermissionLevel,
  useHasAccess,
  useLocalize,
  useSelectAgent,
  useShowMarketplace,
} from '~/hooks';
import { useListAgentsQuery } from '~/data-provider';
import { renderAgentAvatar } from '~/utils';

const AgentsMenu: FC = () => {
  const navigate = useNavigate();
  const localize = useLocalize();
  const triggerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { onSelect } = useSelectAgent();
  const permissionLevel = useAgentDefaultPermissionLevel();
  const showMarketplace = useShowMarketplace();
  const hasAccessToAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.USE,
  });
  const { data: agents = [] } = useListAgentsQuery(
    { requiredPermission: permissionLevel },
    { select: (response) => response.data },
  );

  const selectAgent = useCallback(
    async (agentId: string) => {
      setOpen(false);
      await onSelect(agentId);
    },
    [onSelect],
  );

  const openMarketplace = useCallback(() => {
    setOpen(false);
    navigate('/agents');
  }, [navigate]);

  if (!hasAccessToAgents) {
    return null;
  }

  return (
    <Root open={open} onOpenChange={setOpen}>
      <Trigger asChild>
        <TooltipAnchor
          ref={triggerRef}
          description={localize('com_ui_agents')}
          render={
            <Button
              size="icon"
              variant="outline"
              id="agents-button"
              data-testid="agents-button"
              aria-label={localize('com_ui_agents')}
              className="rounded-xl bg-presentation p-2 duration-0 hover:bg-surface-active-alt"
            >
              <Bot className="icon-lg" aria-hidden="true" />
            </Button>
          }
        />
      </Trigger>
      <Portal>
        <Content
          side="bottom"
          align="center"
          sideOffset={8}
          className="z-50 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-border-light bg-presentation p-2 text-text-primary shadow-lg"
        >
          <div className="px-2 pb-2 pt-1 text-sm font-semibold">{localize('com_ui_agents')}</div>
          <div className="max-h-[360px] overflow-y-auto">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => selectAgent(agent.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full">
                  {renderAgentAvatar(agent, { size: 'sm', showBorder: false })}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{agent.name || agent.id}</span>
                  {agent.description && (
                    <span className="block truncate text-xs text-text-secondary">
                      {agent.description}
                    </span>
                  )}
                </span>
                {agent.isPublic && (
                  <EarthIcon className="size-4 shrink-0 text-green-400" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
          {showMarketplace && (
            <>
              <div className="my-2 border-t border-border-light" />
              <button
                type="button"
                onClick={openMarketplace}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm font-medium hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <LayoutGrid className="size-5" aria-hidden="true" />
                {localize('com_agents_marketplace')}
              </button>
            </>
          )}
        </Content>
      </Portal>
    </Root>
  );
};

export default AgentsMenu;
