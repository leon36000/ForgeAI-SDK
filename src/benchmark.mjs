const CATEGORIES = ['mechanical', 'bugfix', 'integration', 'refactor', 'security'];

export function createBenchmarkSlots() {
  return Array.from({ length: 15 }, (_, index) => ({
    slot_id: `F${String(index + 1).padStart(2, '0')}`,
    category: CATEGORIES[index % CATEGORIES.length],
    task_ref: null,
    frozen_commit: null,
    status: 'UNASSIGNED',
  }));
}

export function computeBenchmarkMetrics(runs) {
  if (!Array.isArray(runs) || runs.length === 0) throw new Error('at least one benchmark run is required');
  const sum = (field) => runs.reduce((total, run) => total + Number(run[field] ?? 0), 0);
  const verified = runs.filter((run) => run.verdict === 'PASS');
  const falseDone = runs.filter((run) => run.claimed_done === true && run.verdict !== 'PASS');
  const escaped = sum('escaped_defects');
  const totalCost = sum('cost_usd');
  return Object.freeze({
    runs: runs.length,
    verified_success_rate: verified.length / runs.length,
    false_done_rate: falseDone.length / runs.length,
    escaped_defects: escaped,
    total_cost_usd: totalCost,
    cost_per_verified_success_usd: verified.length === 0 ? null : totalCost / verified.length,
    median_duration_ms: median(runs.map((run) => Number(run.duration_ms ?? 0))),
    total_rework_rounds: sum('rework_rounds'),
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
