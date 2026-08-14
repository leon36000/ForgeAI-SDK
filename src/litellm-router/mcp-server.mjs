import { createInterface } from 'node:readline';
import { MCP_PROTOCOL_VERSION } from './constants.mjs';

const TOOL_NAME = 'forgeai_advisory';
const MAX_LINE_BYTES = 1024 * 1024;

function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message, data) { return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
function hasId(message) { return Object.prototype.hasOwnProperty.call(message, 'id'); }

function toolDefinition() {
  return {
    name: TOOL_NAME,
    title: 'ForgeAI read-only external advisory',
    description: 'Routes CONSULT/AUDIT/REVIEW/JUDGE requests through qualified MCP→LiteLLM read-only routes. It exposes no tools to the external model.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['schema_version', 'request_id', 'mode', 'capability', 'objective', 'context', 'max_output_tokens', 'max_total_tokens', 'max_cost_usd', 'timeout_ms', 'allow_fallback'],
      properties: {
        schema_version: { type: 'string' }, request_id: { type: 'string' }, mode: { enum: ['CONSULT', 'AUDIT', 'REVIEW', 'JUDGE'] },
        capability: { type: 'string' }, objective: { type: 'string' }, context: { type: 'array' }, max_output_tokens: { type: 'integer' },
        max_total_tokens: { type: 'integer' }, max_cost_usd: { type: 'number' }, timeout_ms: { type: 'integer' }, allow_fallback: { type: 'boolean' }, metadata: { type: 'object' },
      },
    },
  };
}

export function createMcpServer({ router, input = process.stdin, output = process.stdout } = {}) {
  if (!router || typeof router.run !== 'function') throw new TypeError('router.run is required');
  let state = 'NEW';
  let closed = false;

  function send(message) {
    if (!closed) output.write(`${JSON.stringify(message)}\n`);
  }

  async function handle(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      if (message && hasId(message)) send(rpcError(message.id, -32600, 'Invalid Request'));
      return;
    }
    const notification = !hasId(message);
    if (message.method === 'initialize') {
      if (notification) return;
      if (state !== 'NEW') { send(rpcError(message.id, -32600, 'Server is already initialized')); return; }
      state = 'INITIALIZING';
      send(rpcResult(message.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'forgeai-litellm-readonly', version: '0.3.0-alpha.1' },
        instructions: 'Read-only external advisory. No model tools and no EXECUTE capability.',
      }));
      return;
    }
    if (message.method === 'notifications/initialized') {
      if (!notification) { send(rpcError(message.id, -32600, 'notifications/initialized must not include an id')); return; }
      if (state === 'INITIALIZING') state = 'READY';
      return;
    }
    if (notification) return;
    if (state !== 'READY') { send(rpcError(message.id, -32002, 'Server is not initialized')); return; }
    if (message.method === 'ping') { send(rpcResult(message.id, {})); return; }
    if (message.method === 'tools/list') { send(rpcResult(message.id, { tools: [toolDefinition()] })); return; }
    if (message.method === 'tools/call') {
      if (message.params?.name !== TOOL_NAME) { send(rpcError(message.id, -32602, 'Unknown tool')); return; }
      try {
        const result = await router.run(message.params?.arguments);
        send(rpcResult(message.id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: result.status === 'BLOCKED' }));
      } catch (error) {
        send(rpcError(message.id, -32603, 'Router failure', { code: error.code ?? 'INTERNAL_ERROR' }));
      }
      return;
    }
    send(rpcError(message.id, -32601, 'Method not found'));
  }

  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  lines.on('line', (line) => {
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) { send(rpcError(null, -32700, 'Message too large')); return; }
    let message;
    try { message = JSON.parse(line); } catch { send(rpcError(null, -32700, 'Parse error')); return; }
    Promise.resolve(handle(message)).catch(() => send(rpcError(hasId(message) ? message.id : null, -32603, 'Internal error'));
  });
  lines.on('close', () => { closed = true; });
  return Object.freeze({ get state() { return state; }, close() { closed = true; lines.close(); } });
}

export const MCP_TOOL_NAME = TOOL_NAME;
