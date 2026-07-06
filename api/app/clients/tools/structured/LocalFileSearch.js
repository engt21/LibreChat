const { Tool } = require('@langchain/core/tools');

const localFileSearchJsonSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query for the files attached to this agent.',
    },
  },
  required: ['query'],
};

class LocalFileSearch extends Tool {
  static lc_name() {
    return 'local_file_search';
  }

  static get jsonSchema() {
    return localFileSearchJsonSchema;
  }

  constructor(fields = {}) {
    super(fields);
    this.name = 'local_file_search';
    this.description =
      'Search files attached to this agent using the local LibreChat vector database.';
    this.schema = localFileSearchJsonSchema;
    this.override = fields.override ?? false;
  }

  async _call() {
    throw new Error('local_file_search must be initialized with agent file context.');
  }
}

module.exports = LocalFileSearch;
