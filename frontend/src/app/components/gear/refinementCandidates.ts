import type { TopGearResult } from './topGearResultsTypes';

/** Match server selection. Precision is stored rounded to two decimals. */
export function refinementCandidates(
  results: TopGearResult[],
  target: number | undefined,
  margin: number,
  mode: 'auto' | 'custom' = 'custom'
): TopGearResult[] | null {
  if (!target || target <= 0 || !Number.isFinite(margin) || margin < 0 || margin > 10) return null;
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
      (mode === 'auto'
        ? row.precision_pct == null ||
          row.precision_pct < 0 ||
          row.dps * (1 + row.precision_pct / 100) >= lower
        : margin === 0
          ? row.dps > best
          : row.dps >= cutoff)
  );
}
