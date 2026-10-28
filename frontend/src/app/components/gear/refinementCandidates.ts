import type { TopGearResult } from './topGearResultsTypes';

/** Match server selection. Precision is stored rounded to two decimals. */
export function refinementCandidates(
  results: TopGearResult[],
  target: number | undefined,
  margin: number
): TopGearResult[] | null {
  if (!target || target <= 0 || !Number.isFinite(margin) || margin < 0 || margin > 10) return null;
  const precise = (row: TopGearResult) =>
    row.precision_pct != null && row.precision_pct <= target + 0.005;
  const reference = results.filter(precise);
  if (!reference.length) return null;
  const best = Math.max(...reference.map((row) => row.dps));
  const cutoff = best * (1 - margin / 100);
  return results.filter(
    (row) =>
      /^Combo \d+$/.test(row.name) &&
      !precise(row) &&
      (margin === 0 ? row.dps > best : row.dps >= cutoff)
  );
}
