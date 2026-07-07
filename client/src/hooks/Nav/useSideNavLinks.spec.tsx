import { renderHook } from '@testing-library/react';
import { EModelEndpoint } from 'librechat-data-provider';
import useSideNavLinks from './useSideNavLinks';

const mockUseHasAccess = jest.fn();
const mockUseMCPServerManager = jest.fn();

jest.mock('~/hooks', () => ({
  useHasAccess: (...args: unknown[]) => mockUseHasAccess(...args),
  useMCPServerManager: (...args: unknown[]) => mockUseMCPServerManager(...args),
}));

jest.mock('~/components/SidePanel/MCPBuilder/MCPBuilderPanel', () => () => null);
jest.mock('~/components/SidePanel/Agents/AgentPanelSwitch', () => () => null);
jest.mock('~/components/SidePanel/Bookmarks/BookmarkPanel', () => () => null);
jest.mock('~/components/SidePanel/Builder/PanelSwitch', () => () => null);
jest.mock('~/components/Prompts/PromptsAccordion', () => () => null);
jest.mock('~/components/SidePanel/Parameters/Panel', () => () => null);
jest.mock('~/components/SidePanel/Memories', () => ({
  MemoryPanel: () => null,
}));
jest.mock('~/components/SidePanel/Usage', () => ({
  ThreadUsagePanel: () => null,
}));
jest.mock('~/components/SidePanel/Files/Panel', () => () => null);
jest.mock('~/components/SidePanel/Tree/ConversationTreePanel', () => () => null);

describe('useSideNavLinks', () => {
  beforeEach(() => {
    mockUseHasAccess.mockReturnValue(true);
    mockUseMCPServerManager.mockReturnValue({ availableMCPServers: [] });
  });

  it('inserts conversation tree after thread usage, before memories, and keeps hide-panel last', () => {
    const { result } = renderHook(() =>
      useSideNavLinks({
        hidePanel: jest.fn(),
        keyProvided: true,
        endpoint: EModelEndpoint.openAI,
        endpointType: EModelEndpoint.openAI,
        interfaceConfig: { parameters: true },
        endpointsConfig: {
          [EModelEndpoint.agents]: { disableBuilder: true },
        } as any,
      }),
    );

    const ids = result.current.map((link) => link.id);

    expect(ids.indexOf('conversation-tree')).toBe(ids.indexOf('thread-usage') + 1);
    expect(ids.indexOf('conversation-tree')).toBeLessThan(ids.indexOf('memories'));
    expect(ids.at(-1)).toBe('hide-panel');
  });
});
