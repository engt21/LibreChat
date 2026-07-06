const { Tool } = require('@langchain/core/tools');

const agentBuilderJsonSchema = {
  type: 'object',
  properties: {
    confirm_creation: {
      type: 'boolean',
      description:
        'Must be true only after the user explicitly asks to create/save the agent. Never create an agent speculatively.',
    },
    name: { type: 'string', description: 'Agent display name.' },
    description: { type: 'string', description: 'Short description of the agent.' },
    instructions: { type: 'string', description: 'Detailed system instructions for the agent.' },
    provider: {
      type: 'string',
      description: 'LibreChat provider/endpoint. Omit to use the current chat provider.',
    },
    model: {
      type: 'string',
      description: 'Model identifier. Omit to use the current chat model.',
    },
    category: { type: 'string', description: 'Optional agent category.' },
    conversation_starters: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional suggested opening prompts.',
    },
    tools: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Provider-native, local structured, or MCP tool IDs to attach. Use local_code_interpreter for the self-hosted sandbox.',
    },
    model_parameters: {
      type: 'object',
      additionalProperties: true,
      description: 'Optional model parameters supported by the selected provider.',
    },
  },
  required: ['confirm_creation', 'name', 'instructions'],
};

class AgentBuilder extends Tool {
  static lc_name() {
    return 'agent_builder';
  }

  static get jsonSchema() {
    return agentBuilderJsonSchema;
  }

  constructor(fields = {}) {
    super(fields);
    this.name = 'agent_builder';
    this.description = [
      "Creates and saves a LibreChat agent from the user's conversational requirements.",
      'Use only when the user explicitly asks to build, create, or save an agent.',
      'Prefer the current provider/model unless the user requests another accessible model.',
      'Attach provider-native tools when requested and local structured or MCP tools when appropriate.',
    ].join(' ');
    this.schema = agentBuilderJsonSchema;
    this.override = fields.override ?? false;
    this.req = fields.req;
    this.defaultProvider = fields.defaultProvider;
    this.defaultModel = fields.defaultModel;
  }

  async _call(input) {
    if (!input?.confirm_creation) {
      return JSON.stringify({
        created: false,
        error: 'Agent creation requires explicit user confirmation.',
      });
    }

    if (!this.req?.user) {
      return JSON.stringify({
        created: false,
        error: 'Authenticated request context is required.',
      });
    }

    const provider = input.provider || this.defaultProvider;
    const model = input.model || this.defaultModel;
    if (!provider || !model) {
      return JSON.stringify({
        created: false,
        error: 'A provider and model are required. Specify them or create from a model chat.',
      });
    }

    const requestedTools = Array.isArray(input.tools) ? input.tools : [];
    const { createAgent } = require('~/server/controllers/agents/v1');
    let statusCode = 200;
    let responseBody;
    const response = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      },
    };

    await createAgent(
      {
        ...this.req,
        body: {
          name: input.name,
          description: input.description,
          instructions: input.instructions,
          provider,
          model,
          category: input.category,
          conversation_starters: input.conversation_starters,
          tools: requestedTools,
          model_parameters: input.model_parameters,
        },
      },
      response,
    );

    if (statusCode >= 400 || !responseBody?.id) {
      return JSON.stringify({
        created: false,
        status: statusCode,
        error: responseBody?.error || 'Agent creation failed.',
        details: responseBody?.details,
      });
    }

    return JSON.stringify({
      created: true,
      agent_id: responseBody.id,
      name: responseBody.name,
      provider: responseBody.provider,
      model: responseBody.model,
      tools: responseBody.tools ?? [],
      message: 'Agent created successfully. It is available in My Agents for review or editing.',
    });
  }
}

module.exports = AgentBuilder;
