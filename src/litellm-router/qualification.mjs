import { QUALIFIED_HARNESS } from './constants.mjs';

function qualificationFailure(code, reason) {
  return Object.freeze({ qualified: false, code, reason });
}

function qualificationStatusFailure(route) {
  if (route.status === 'DISABLED') return qualificationFailure('ROUTE_DISABLED', 'route is disabled');
  if (route.status !== 'QUALIFIED') return qualificationFailure('ROUTE_UNQUALIFIED', 'route has no accepted qualification');
  return null;
}

function qualificationRecordFailure(qualification) {
  if (!qualification || qualification.status !== 'QUALIFIED') return qualificationFailure('QUALIFICATION_MISSING', 'qualification record is missing');
  if (qualification.harness !== QUALIFIED_HARNESS) return qualificationFailure('HARNESS_UNQUALIFIED', 'qualification targets a different harness');
  return null;
}

function qualificationWindowFailure(qualification, now) {
  const qualifiedAt = Date.parse(qualification.qualified_at);
  const expiresAt = Date.parse(qualification.expires_at);
  if (!Number.isFinite(qualifiedAt) || !Number.isFinite(expiresAt) || expiresAt <= qualifiedAt) return qualificationFailure('QUALIFICATION_INVALID', 'qualification timestamps are invalid');
  if (qualifiedAt > now) return qualificationFailure('QUALIFICATION_NOT_YET_VALID', 'qualification starts in the future');
  if (expiresAt <= now) return qualificationFailure('QUALIFICATION_EXPIRED', 'qualification has expired');
  return null;
}

export function evaluateRouteQualification(route, { now = Date.now() } = {}) {
  if (!route || typeof route !== 'object') throw new TypeError('route is required');
  if (!Number.isFinite(now)) throw new TypeError('now must be finite');
  const statusFailure = qualificationStatusFailure(route);
  if (statusFailure) return statusFailure;
  const qualification = route.qualification;
  const recordFailure = qualificationRecordFailure(qualification);
  if (recordFailure) return recordFailure;
  const windowFailure = qualificationWindowFailure(qualification, now);
  if (windowFailure) return windowFailure;
  return Object.freeze({ qualified: true, code: 'QUALIFIED', reason: 'route qualification is valid', benchmark_id: qualification.benchmark_id, evidence_sha256: qualification.evidence_sha256, expires_at: qualification.expires_at });
}

export function qualifiedRoutesForRequest(policy, request, { now = Date.now(), circuitBreakers = new Map() } = {}) {
  const ids = policy.capability_routes[request.capability] ?? [];
  const routeById = new Map(policy.routes.map((route) => [route.route_id, route]));
  const candidates = [];
  const rejected = [];
  for (const routeId of ids) {
    const route = routeById.get(routeId);
    if (!route) continue;
    if (!route.modes.includes(request.mode)) { rejected.push({ route_id: routeId, code: 'MODE_UNSUPPORTED' }); continue; }
    const qualification = evaluateRouteQualification(route, { now });
    if (!qualification.qualified) { rejected.push({ route_id: routeId, code: qualification.code }); continue; }
    const breaker = circuitBreakers.get(routeId);
    const circuit = breaker?.canAttempt(routeId) ?? { allowed: true, state: 'CLOSED' };
    if (!circuit.allowed) { rejected.push({ route_id: routeId, code: 'CIRCUIT_OPEN', retry_at: circuit.retry_at }); continue; }
    candidates.push(route);
  }
  return Object.freeze({ candidates: Object.freeze(candidates), rejected: Object.freeze(rejected) });
}
