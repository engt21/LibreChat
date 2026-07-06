const mockCreateAgent = jest.fn();

jest.mock('~/server/controllers/agents/v1', () => ({
  createAgent: (...args) => mockCreateAgent(...args),
}));

const AgentBuilder = require('../AgentBuilder');

describe('AgentBuilder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires explicit creation confirmation', async () => {
    const tool = new AgentBuilder({
      req: { user: { id: 'user-1' } },
      defaultProvider: 'openAI',
      defaultModel: 'gpt-5',
    });

    const result = JSON.parse(
      await tool._call({ name: 'Researcher', instructions: 'Research carefully.' }),
    );

    expect(result.created).toBe(false);
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('creates an agent with provider, local, and custom tools using current model defaults', async () => {
    mockCreateAgent.mockImplementation(async (req, res) => {
      res.status(201).json({
        id: 'agent_created',
        name: req.body.name,
        provider: req.body.provider,
        model: req.body.model,
        tools: req.body.tools,
      });
    });

    const tool = new AgentBuilder({
      req: { user: { id: 'user-1' } },
      defaultProvider: 'openAI',
      defaultModel: 'gpt-5',
    });

    const result = JSON.parse(
      await tool._call({
        confirm_creation: true,
        name: 'Researcher',
        instructions: 'Research carefully.',
        tools: [
          'agent_builder',
          'execute_code',
          'web_search',
          'local_code_interpreter',
          'local_file_search',
          'image_gen_oai',
        ],
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        created: true,
        agent_id: 'agent_created',
        provider: 'openAI',
        model: 'gpt-5',
      }),
    );
    expect(mockCreateAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          provider: 'openAI',
          model: 'gpt-5',
          tools: [
            'agent_builder',
            'execute_code',
            'web_search',
            'local_code_interpreter',
            'local_file_search',
            'image_gen_oai',
          ],
        }),
      }),
      expect.any(Object),
    );
  });
});
