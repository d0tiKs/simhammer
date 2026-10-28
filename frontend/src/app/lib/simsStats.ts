import type { JobOverviewSummary } from './api';

export function computeSimsStats(sims: JobOverviewSummary[]) {
  let completed = 0;
  let bestJob: JobOverviewSummary | null = null;
  const characters = new Set<string>();
  for (const sim of sims) {
    if (sim.status === 'done') {
      completed++;
      if (
        sim.player_name?.trim() &&
        sim.precise_dps != null &&
        Number.isFinite(sim.precise_dps) &&
        sim.precise_dps > 0 &&
        sim.precise_error_pct != null &&
        Number.isFinite(sim.precise_error_pct) &&
        sim.precise_error_pct >= 0 &&
        sim.precise_dps > (bestJob?.precise_dps ?? 0)
      )
        bestJob = sim;
    }
    if (sim.player_name) characters.add(`${sim.player_name}-${sim.realm ?? ''}`);
  }
  return {
    totalSims: sims.length,
    completedSims: completed,
    completionRate: sims.length ? (completed / sims.length) * 100 : 0,
    uniqueCharacters: characters.size,
    bestJob,
    bestDps: bestJob?.precise_dps ?? 0,
  };
}
