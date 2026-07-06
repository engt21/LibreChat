import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentsMenu from './AgentsMenu';

const mockNavigate = jest.fn();
const mockSelectAgent = jest.fn();
let mockHasAccess = true;

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('~/hooks', () => ({
  useAgentDefaultPermissionLevel: () => 1,
  useHasAccess: () => mockHasAccess,
  useLocalize: () => (key: string) =>
    ({
      com_ui_agents: 'Agents',
      com_agents_marketplace: 'Agent Marketplace',
    })[key] ?? key,
  useSelectAgent: () => ({ onSelect: mockSelectAgent }),
  useShowMarketplace: () => true,
}));

jest.mock('~/data-provider', () => ({
  useListAgentsQuery: () => ({
    data: [
      {
        id: 'agent-1',
        name: 'Research Agent',
        description: 'Finds and summarizes sources',
        isPublic: false,
      },
    ],
  }),
}));

jest.mock('~/utils', () => ({
  renderAgentAvatar: () => <span>avatar</span>,
}));

describe('AgentsMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasAccess = true;
  });

  it('selects an agent through the dedicated agents menu', async () => {
    render(
      <MemoryRouter>
        <AgentsMenu />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    fireEvent.click(await screen.findByRole('button', { name: /Research Agent/ }));

    await waitFor(() => expect(mockSelectAgent).toHaveBeenCalledWith('agent-1'));
  });

  it('opens the agent marketplace from the dedicated menu', async () => {
    render(
      <MemoryRouter>
        <AgentsMenu />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Agent Marketplace' }));

    expect(mockNavigate).toHaveBeenCalledWith('/agents');
  });

  it('stays hidden without agent use permission', () => {
    mockHasAccess = false;

    render(
      <MemoryRouter>
        <AgentsMenu />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Agents' })).not.toBeInTheDocument();
  });
});
