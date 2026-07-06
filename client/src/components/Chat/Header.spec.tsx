import { render, screen } from '@testing-library/react';
import Header from './Header';

const mockStartupConfig = {
  interface: {
    modelSelect: true,
    presets: true,
  },
  modelSpecs: {
    addedEndpoints: ['openAI', 'anthropic', 'azureOpenAI', 'google', 'xai', 'ollama'],
    list: [
      { name: 'Chat Latest', label: 'Chat Latest' },
      { name: 'GPT-5.6', label: 'GPT-5.6' },
      { name: 'Claude Sonnet 4.6', label: 'Claude Sonnet 4.6' },
      { name: 'Claude Opus 4.7', label: 'Claude Opus 4.7' },
    ],
  },
};

jest.mock('@librechat/client', () => ({
  useMediaQuery: () => false,
}));

jest.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

jest.mock('react-router-dom', () => ({
  useOutletContext: () => ({ navVisible: true, setNavVisible: jest.fn() }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
}));

jest.mock('~/hooks', () => ({
  useHasAccess: () => false,
}));

jest.mock('./Menus', () => ({
  AgentsMenu: () => <button>Agents</button>,
  PresetsMenu: () => <button>Presets</button>,
  HeaderNewChat: () => <button>New Chat</button>,
  OpenSidebar: () => <button>Open sidebar</button>,
}));

jest.mock('./Menus/Endpoints/ModelSelector', () => ({
  __esModule: true,
  default: ({ startupConfig }: { startupConfig: typeof mockStartupConfig }) => (
    <section aria-label="Model Selector">
      <div data-testid="provider-order">{startupConfig.modelSpecs.addedEndpoints.join(',')}</div>
      {startupConfig.modelSpecs.list.map((spec) => (
        <span key={spec.name}>{spec.label}</span>
      ))}
    </section>
  ),
}));

jest.mock('./ExportAndShareMenu', () => () => <button>Export and share</button>);
jest.mock('./Menus/BookmarkMenu', () => () => <button>Bookmarks</button>);
jest.mock('./TemporaryChat', () => ({ TemporaryChat: () => <button>Temporary Chat</button> }));
jest.mock('./AddMultiConvo', () => () => <button>Multi-conversation</button>);

describe('Header model controls', () => {
  it('keeps the model selector, Agents, presets, provider order, and suggested models together', () => {
    render(<Header />);

    expect(screen.getByRole('region', { name: 'Model Selector' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Presets' })).toBeInTheDocument();
    expect(screen.getByTestId('provider-order')).toHaveTextContent(
      'openAI,anthropic,azureOpenAI,google,xai,ollama',
    );
    expect(screen.getAllByText(/Chat Latest|GPT-5.6|Claude Sonnet 4.6|Claude Opus 4.7/)).toHaveLength(
      4,
    );
  });
});
