import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createMcpServer } from '../src/litellm-router/mcp-server.mjs';
import { request } from './litellm-router-helpers.mjs';

function harness(result = { status: 'PASS', request_id: 'request-1' }) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding('utf8');
  let text = '';
  output.on('data', (chunk) => { text += chunk; });
  const calls = [];
  const router = { run: async (value) => { calls.push(value); return result; } };
  const server = createMcpServer({ router, input, output });
  const send = (value) => input.write(`${JSON.stringify(value)}\n`);
  const messages = () => text.trim().split('\n').filter(Boolean).map(JSON.parse);
  const wait = async (count) => {
    const deadline = Date.now() + 1000;
    while (messages().length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    return messages();
  };
  return { input, output, server, send, wait, calls, messages };
}

test('MCP lifecycle rejects tool discovery before initialization', async (t) => {
  const h = harness(); t.after(() => h.server.close());
  h.send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  const [message] = await h.wait(1);
  assert.equal(message.error.code, -32002);
});

test('MCP initialize then initialized notification enables tools', async (t) => {
  const h = harness(); t.after(() => h.server.close());
  h.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  let messages = await h.wait(1);
  assert.equal(messages[0].result.protocolVersion, '2025-11-25');
  h.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  h.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  messages = await h.wait(2);
  assert.equal(messages[1].result.tools[0].name, 'forgeai_advisory');
});

test('notifications never receive a response', async (t) => {
  const h = harness(); t.after(() => h.server.close());
  h.send({ jsonrpc: '2.0', method: 'unknown/notification', params: {} });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(h.messages().length, 0);
});

test('notifications/initialized with an id is rejected', async (t) => {
  const h = harness(); t.after(() => h.server.close());
  h.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  await h.wait(1);
  h.send({ jsonrpc: '2.0', id: 2, method: 'notifications/initialized', params: {} });
  const messages = await h.wait(2);
  assert.equal(messages[1].error.code, -32600);
});

test('tool call invokes only the read-only router request', async (t) => {
  const h = harness({ status: 'PASS', request_id: 'request-1', result: { summary: 'ok' } }); t.after(() => h.server.close());
  h.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  await h.wait(1);
  h.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  h.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'forgeai_advisory', arguments: request() } });
  const messages = await h.wait(2);
  assert.equal(messages[1].result.isError, false);
  assert.equal(h.calls.length, 1);
  assert.equal(Object.hasOwn(h.calls[0], 'tools'), false);
});

test('unknown MCP tools are rejected', async (t) => {
  const h = harness(); t.after(() => h.server.close());
  h.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }); await h.wait(1);
  h.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  h.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'execute', arguments: {} } });
  const messages = await h.wait(2);
  assert.equal(messages[1].error.code, -32602);
  assert.equal(h.calls.length, 0);
});
