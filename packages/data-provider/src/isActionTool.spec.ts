import { isActionTool, actionDelimiter } from './types/assistants';

describe('isActionTool', () => {
  it('recognizes a standard action tool name', () => {
    expect(isActionTool(`getWeather${actionDelimiter}weather_com`)).toBe(true);
  });

  it('rejects a plain built-in tool name', () => {
    expect(isActionTool('web_search')).toBe(false);
  });

  it('rejects an MCP tool with _action_ in its name (cross-delimiter collision)', () => {
    // MCP format: toolName_mcp_serverName — but toolName happens to contain _action_
    expect(isActionTool('get_action_mcp_srv')).toBe(false);
  });

  it('rejects an MCP tool with _action_ in the middle of its name', () => {
    expect(isActionTool('get_action_data_mcp_myserver')).toBe(false);
  });

  it('accepts an action tool whose operationId contains _mcp_ before _action_', () => {
    // Valid action: operationId is sync_mcp_state, domain is api---example---com
    expect(isActionTool('sync_mcp_state_action_api---example---com')).toBe(true);
  });

  it('rejects a tool with neither _action_ nor _mcp_', () => {
    expect(isActionTool('calculator')).toBe(false);
  });

  it('rejects a tool with only _mcp_ delimiter', () => {
    expect(isActionTool('list_items_mcp_server_one')).toBe(false);
  });

  it('accepts a simple action tool without _mcp_ anywhere', () => {
    expect(isActionTool('listItems_action_api---example---com')).toBe(true);
  });
});
