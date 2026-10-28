import type { JobOverviewSummary } from '../../lib/api';
import { isActiveStatus } from '../../lib/useActiveSims';

export function StatsOverview({ sims }: { sims: JobOverviewSummary[] }) {
  const counts = [
    [sims.length, 'runs'],
    [sims.filter((j) => isActiveStatus(j.status)).length, 'active'],
    [sims.filter((j) => j.status === 'done').length, 'completed'],
    [sims.filter((j) => j.status === 'failed').length, 'failed'],
  ];
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-line/[0.06] py-3 text-sm text-outline">
      {counts.map(([count, label]) => (
        <span key={label}>
          <b className="text-on-surface">{count}</b> {label}
        </span>
      ))}
    </div>
  );
}
