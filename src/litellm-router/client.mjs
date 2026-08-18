import { createHash } from 'node:crypto';
import { LITELLM_ROUTER_LIMITS } from './constants.mjs';

export class LiteLLMClientError extends Error {
  constructor(code, message, { retryable = false, responseReceived = false, httpStatus = null, details = {} } = {}) {
    super(message);
    this.name = 'LiteLLMClientError';
    this.code = code;
    this.retryable = retryable;
    this.responseReceived = responseReceived;
    this.httpStatus = httpStatus;
    this.details = Object.freeze(structuredClone(details));
  }
}

function endpointUrl(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new LiteLLMClientError('ENDPOINT_INVALID', 'LiteLLM endpoint is not a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new LiteLLMClientError('ENDPOINT_PROTOCOL_DENIED', 'LiteLLM endpoint must use HTTP or HTTPS');
  if (url.username || url.password || url.hash) throw new LiteLLMClientError('ENDPOINT_INVALID', 'LiteLLM endpoint must not contain credentials or a fragment');
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/v1/chat/completions`.replace(/\/+/gu, '/');
  url.search = '';
  return url;
}

function timeoutError(stage) {
  return new LiteLLMClientError('LITELLM_TIMEOUT', `LiteLLM ${stage} exceeded the absolute deadline`, { retryable: true });
}

async function raceDeadline(promise, deadlineAt, clock, controller, stage) {
  const remaining = deadlineAt - clock();
  if (remaining <= 0) {
    controller.abort(timeoutError(stage));
    throw timeoutError(stage);
  }
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(timeoutError(stage));
          reject(timeoutError(stage));
        }, remaining);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function decodeResponseBytes(bytes, response) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new LiteLLMClientError('RESPONSE_ENCODING_INVALID', 'LiteLLM response was not valid UTF-8', { responseReceived: true, httpStatus: response.status }); }
}

function mergeBodyChunks(chunks, totalBytes) {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return merged;
}

async function readStreamingBody(response, { deadlineAt, clock, controller, maxBytes }) {
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await raceDeadline(reader.read(), deadlineAt, clock, controller, 'response body');
      if (item.done) break;
      const chunk = item.value instanceof Uint8Array ? item.value : new Uint8Array(item.value);
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        controller.abort();
        void reader.cancel().catch(() => {});
        throw new LiteLLMClientError('RESPONSE_TOO_LARGE', 'LiteLLM response exceeded the byte limit', { responseReceived: true, httpStatus: response.status });
      }
      chunks.push(chunk);
    }
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
  return decodeResponseBytes(mergeBodyChunks(chunks, bytes), response);
}

async function readBufferedBody(response, { deadlineAt, clock, controller, maxBytes }) {
  const buffer = await raceDeadline(response.arrayBuffer(), deadlineAt, clock, controller, 'response body');
  if (buffer.byteLength > maxBytes) throw new LiteLLMClientError('RESPONSE_TOO_LARGE', 'LiteLLM response exceeded the byte limit', { responseReceived: true, httpStatus: response.status });
  return decodeResponseBytes(buffer, response);
}

async function readBoundedBody(response, options) {
  return response.body?.getReader ? readStreamingBody(response, options) : readBufferedBody(response, options);
}

function parseInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new LiteLLMClientError('USAGE_INVALID', `${label} is missing or invalid`, { responseReceived: true });
  return value;
}

function parseUsageTokens(usage, details) {
  const input = parseInteger(usage.prompt_tokens ?? usage.input_tokens, 'input token usage');
  const output = parseInteger(usage.completion_tokens ?? usage.output_tokens, 'output token usage');
  const total = parseInteger(usage.total_tokens, 'total token usage');
  if (total < input + output) throw new LiteLLMClientError('USAGE_INVALID', 'total token usage is smaller than input plus output', { responseReceived: true, details });
  return Object.freeze({ input_tokens: input, output_tokens: output, total_tokens: total });
}

function extractUsage(payload, responseCost) {
  const usage = payload?.usage;
  const details = responseCost === null ? {} : { response_cost_usd: responseCost };
  if (!usage || typeof usage !== 'object') throw new LiteLLMClientError('USAGE_MISSING', 'a billed HTTP 200 response did not contain reliable token usage', { responseReceived: true, details });
  try { return parseUsageTokens(usage, details); }
  catch (error) {
    if (error instanceof LiteLLMClientError) throw new LiteLLMClientError(error.code, error.message, { responseReceived: true, details });
    throw error;
  }
}

function headerCost(response) {
  const value = response.headers?.get?.('x-litellm-response-cost');
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function payloadCost(payload) {
  const values = [payload?.response_cost, payload?._hidden_params?.response_cost, payload?.hidden_params?.response_cost];
  for (const value of values) if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return null;
}

function assistantMessage(payload) {
  const choice = payload?.choices?.[0];
  if (!choice || typeof choice !== 'object') throw new LiteLLMClientError('RESPONSE_INVALID', 'LiteLLM response has no first choice', { responseReceived: true });
  const message = choice.message;
  if (!message || typeof message !== 'object') throw new LiteLLMClientError('RESPONSE_INVALID', 'LiteLLM response has no assistant message', { responseReceived: true });
  return message;
}

function assistantContent(payload) {
  const message = assistantMessage(payload);
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) throw new LiteLLMClientError('TOOL_CALL_DENIED', 'external advisory models may not call tools', { responseReceived: true });
  if (typeof message.content !== 'string' || message.content.length === 0) throw new LiteLLMClientError('RESPONSE_INVALID', 'assistant content must be a non-empty string', { responseReceived: true });
  return message.content;
}

function validateApiKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) throw new LiteLLMClientError('API_KEY_MISSING', 'LiteLLM API key is missing');
}

function createRequestContext({ baseUrl, timeoutMs, externalSignal, clock }) {
  const url = endpointUrl(baseUrl);
  const controller = new AbortController();
  const deadlineAt = clock() + timeoutMs;
  const onExternalAbort = () => controller.abort(externalSignal.reason);
  externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
  if (externalSignal?.aborted) controller.abort(externalSignal.reason);
  return { url, controller, deadlineAt, onExternalAbort };
}

function buildChatPayload({ model, systemPrompt, userPrompt, maxOutputTokens, requestId }) {
  return {
    model,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    max_tokens: maxOutputTokens,
    stream: false,
    temperature: 0,
    response_format: { type: 'json_object' },
    user: requestId,
  };
}

async function performRequest({ fetchImpl, context, apiKey, body, requestId, externalSignal, clock }) {
  try {
    return await raceDeadline(fetchImpl(context.url, {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-forgeai-request-id': requestId },
      body: JSON.stringify(body),
      signal: context.controller.signal,
      redirect: 'error',
    }), context.deadlineAt, clock, context.controller, 'request');
  } catch (error) {
    if (error instanceof LiteLLMClientError) throw error;
    if (context.controller.signal.aborted) throw timeoutError('request');
    throw new LiteLLMClientError('LITELLM_NETWORK_ERROR', 'LiteLLM request failed before a response was received', { retryable: true, details: { cause: error?.name ?? 'Error' } });
  } finally {
    externalSignal?.removeEventListener?.('abort', context.onExternalAbort);
  }
}

function rejectHttpError(response, text) {
  if (response.ok) return;
  throw new LiteLLMClientError(`LITELLM_HTTP_${response.status}`, `LiteLLM returned HTTP ${response.status}`, {
    retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    responseReceived: false,
    httpStatus: response.status,
    details: { body_sha256: createHash('sha256').update(text).digest('hex') },
  });
}

function parseBilledPayload({ text, response, responseCostHeader }) {
  try { return JSON.parse(text); }
  catch {
    throw new LiteLLMClientError('RESPONSE_JSON_INVALID', 'billed HTTP 200 response was not valid JSON', {
      responseReceived: true,
      httpStatus: response.status,
      details: responseCostHeader === null ? {} : { response_cost_usd: responseCostHeader },
    });
  }
}

function finalizeSuccessfulResponse({ payload, response, responseCostHeader, model }) {
  const responseCost = payloadCost(payload) ?? responseCostHeader;
  const usage = extractUsage(payload, responseCost);
  let content;
  try { content = assistantContent(payload); }
  catch (error) {
    if (error instanceof LiteLLMClientError) throw new LiteLLMClientError(error.code, error.message, { responseReceived: true, httpStatus: response.status, details: { usage, response_cost_usd: responseCost } });
    throw error;
  }
  return Object.freeze({ content, usage, response_cost_usd: responseCost, response_id: typeof payload.id === 'string' ? payload.id : null, model: typeof payload.model === 'string' ? payload.model : model, http_status: response.status });
}

export function createLiteLLMClient({ fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  return Object.freeze({
    async invoke({ baseUrl, apiKey, model, systemPrompt, userPrompt, maxOutputTokens, timeoutMs, requestId, externalSignal }) {
      validateApiKey(apiKey);
      const context = createRequestContext({ baseUrl, timeoutMs, externalSignal, clock });
      const body = buildChatPayload({ model, systemPrompt, userPrompt, maxOutputTokens, requestId });
      const response = await performRequest({ fetchImpl, context, apiKey, body, requestId, externalSignal, clock });
      const text = await readBoundedBody(response, { deadlineAt: context.deadlineAt, clock, controller: context.controller, maxBytes: LITELLM_ROUTER_LIMITS.max_response_bytes });
      rejectHttpError(response, text);
      const responseCostHeader = headerCost(response);
      const payload = parseBilledPayload({ text, response, responseCostHeader });
      return finalizeSuccessfulResponse({ payload, response, responseCostHeader, model });
    },
  });
}
