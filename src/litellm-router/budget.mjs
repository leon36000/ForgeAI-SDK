export class RouterBudgetError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RouterBudgetError';
    this.code = code;
    this.details = Object.freeze(structuredClone(details));
    this.terminal = true;
  }
}

function finiteNonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a finite non-negative number`);
}

export function effectiveRouteLimits(request, route) {
  return Object.freeze({
    max_output_tokens: Math.min(request.max_output_tokens, route.limits.max_output_tokens),
    max_total_tokens: Math.min(request.max_total_tokens, route.limits.max_total_tokens),
    max_cost_usd: Math.min(request.max_cost_usd, route.limits.max_cost_usd),
    max_timeout_ms: Math.min(request.timeout_ms, route.limits.max_timeout_ms),
  });
}

export function deriveResponseCost({ usage, responseCost, pricing }) {
  if (typeof responseCost === 'number' && Number.isFinite(responseCost) && responseCost >= 0) return responseCost;
  if (!pricing) return null;
  if (!usage || !Number.isInteger(usage.input_tokens) || !Number.isInteger(usage.output_tokens)) return null;
  return ((usage.input_tokens * pricing.input_per_million_usd) + (usage.output_tokens * pricing.output_per_million_usd)) / 1_000_000;
}

export function createBudgetTracker({ maxCostUsd, maxTotalTokens, deadlineAt, clock = Date.now } = {}) {
  finiteNonNegative(maxCostUsd, 'maxCostUsd');
  if (!Number.isInteger(maxTotalTokens) || maxTotalTokens < 1) throw new TypeError('maxTotalTokens must be a positive integer');
  if (!Number.isFinite(deadlineAt)) throw new TypeError('deadlineAt must be finite');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  let costUsd = 0;
  let totalTokens = 0;

  function snapshot() {
    return Object.freeze({
      cost_usd: costUsd,
      total_tokens: totalTokens,
      remaining_cost_usd: Math.max(0, maxCostUsd - costUsd),
      remaining_tokens: Math.max(0, maxTotalTokens - totalTokens),
      remaining_time_ms: Math.max(0, Math.floor(deadlineAt - clock())),
      deadline_at: new Date(deadlineAt).toISOString(),
    });
  }

  return Object.freeze({
    snapshot,
    assertTime() {
      const remaining = deadlineAt - clock();
      if (remaining <= 0) throw new RouterBudgetError('TIME_BUDGET_EXCEEDED', 'request deadline has expired', snapshot());
      return Math.floor(remaining);
    },
    record({ costUsd: responseCost, totalTokens: responseTokens }) {
      finiteNonNegative(responseCost, 'response cost');
      if (!Number.isInteger(responseTokens) || responseTokens < 0) throw new TypeError('response tokens must be a non-negative integer');
      costUsd += responseCost;
      totalTokens += responseTokens;
      const current = snapshot();
      if (costUsd > maxCostUsd + Number.EPSILON) throw new RouterBudgetError('COST_BUDGET_EXCEEDED', 'response exceeded the cost budget', current);
      if (totalTokens > maxTotalTokens) throw new RouterBudgetError('TOKEN_BUDGET_EXCEEDED', 'response exceeded the token budget', current);
      return current;
    },
  });
}
