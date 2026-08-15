function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be an integer >= 1`);
}

export function createCircuitBreaker({ failureThreshold, cooldownMs, clock = Date.now } = {}) {
  requirePositiveInteger(failureThreshold, 'failureThreshold');
  requirePositiveInteger(cooldownMs, 'cooldownMs');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const states = new Map();

  function requireRouteId(routeId) {
    if (typeof routeId !== 'string' || routeId.length === 0) throw new TypeError('routeId must be a non-empty string');
  }

  function current(routeId) {
    requireRouteId(routeId);
    return states.get(routeId) ?? { state: 'CLOSED', failures: 0, opened_at: null, retry_at: null };
  }

  function refresh(routeId) {
    const state = current(routeId);
    if (state.state === 'OPEN' && clock() >= state.retry_at) {
      const reset = { state: 'CLOSED', failures: 0, opened_at: null, retry_at: null };
      states.set(routeId, reset);
      return reset;
    }
    return state;
  }

  function snapshot(routeId) {
    return Object.freeze(structuredClone(refresh(routeId)));
  }

  return Object.freeze({
    canAttempt(routeId) {
      const state = refresh(routeId);
      return Object.freeze({ allowed: state.state !== 'OPEN', ...structuredClone(state) });
    },
    recordFailure(routeId) {
      const state = refresh(routeId);
      const failures = state.failures + 1;
      if (failures >= failureThreshold) {
        const openedAt = clock();
        states.set(routeId, { state: 'OPEN', failures, opened_at: openedAt, retry_at: openedAt + cooldownMs });
      } else {
        states.set(routeId, { state: 'CLOSED', failures, opened_at: null, retry_at: null });
      }
      return snapshot(routeId);
    },
    recordSuccess(routeId) {
      requireRouteId(routeId);
      states.set(routeId, { state: 'CLOSED', failures: 0, opened_at: null, retry_at: null });
      return snapshot(routeId);
    },
    snapshot,
  });
}
