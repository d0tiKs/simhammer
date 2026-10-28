import type { TopGearResult } from './topGearResultsTypes';

// Match the backend normal approximation without an extra runtime dependency.
export function improvementProbability(
  dps: number,
  error: number,
  reference: number,
  referenceError: number
): number {
  const se = Math.hypot((dps * error) / 196, (reference * referenceError) / 196);
  if (se === 0) return dps > reference ? 1 : dps < reference ? 0 : 0.5;
  const z = (dps - reference) / se;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const tail =
    (Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)) *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - tail : tail;
}

/** Match server selection. Precision is stored rounded to two decimals. */
export function refinementCandidates(
  results: TopGearResult[],
  target: number | undefined,
  margin: number,
  mode: 'probability' | 'auto' | 'custom' = 'custom',
  minProbability = 20
): TopGearResult[] | null {
  if (!target || target <= 0 || !Number.isFinite(margin) || margin < 0 || margin > 10) return null;
  if (!Number.isFinite(minProbability) || minProbability < 0 || minProbability > 100) return null;
  const precise = (row: TopGearResult) =>
    row.precision_pct != null && row.precision_pct <= target + 0.005;
  const preciseRows = results.filter(precise);
  if (!preciseRows.length) return null;
  const best = Math.max(...preciseRows.map((row) => row.dps));
  const reference = results.find((row) => precise(row) && row.dps === best)!;
  const lower = best * (1 - (reference.precision_pct ?? 0) / 100);
  const cutoff = best * (1 - margin / 100);
  return results.filter(
    (row) =>
      /^Combo \d+$/.test(row.name) &&
      !precise(row) &&
      (mode === 'probability'
        ? row.precision_pct != null &&
          row.precision_pct >= 0 &&
          improvementProbability(
            row.dps,
            row.precision_pct,
            reference.dps,
            reference.precision_pct ?? 0
          ) *
            100 >=
            minProbability
        : mode === 'auto'
          ? row.precision_pct == null ||
            row.precision_pct < 0 ||
            row.dps * (1 + row.precision_pct / 100) >= lower
          : margin === 0
            ? row.dps > best
            : row.dps >= cutoff)
  );
}
