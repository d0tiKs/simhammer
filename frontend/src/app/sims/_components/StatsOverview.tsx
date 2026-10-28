import { useMemo } from 'react';
import type { JobOverviewSummary } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { formatDps } from '../../lib/format';
import { computeSimsStats } from '../../lib/simsStats';

export function StatsOverview({ sims }: { sims: JobOverviewSummary[] }) {
  const { t } = useLanguage();
  const stats = useMemo(() => computeSimsStats(sims), [sims]);
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
      <section className="card px-6 py-5">
        <span className="lbl">{t('sims.statTotalSims')}</span>
        <b className="mb-1 mt-2.5 block font-headline text-[30px] font-extrabold tracking-[-0.02em] text-on-surface">
          {stats.totalSims.toLocaleString()}
        </b>
        <span className="text-[12.5px] text-outline">
          {t('sims.statCompleted', {
            count: stats.completedSims,
            pct: stats.completionRate.toFixed(0),
          })}
        </span>
      </section>
      <section className="card px-6 py-5">
        <span className="lbl">{t('sims.statCharacters')}</span>
        <b className="mb-1 mt-2.5 block font-headline text-[30px] font-extrabold tracking-[-0.02em] text-on-surface">
          {stats.uniqueCharacters}
        </b>
        <span className="text-[12.5px] text-outline">{t('sims.statCharactersSub')}</span>
      </section>
      <section className="card px-6 py-5">
        <span className="lbl">{t('sims.statBestDps')}</span>
        <b className="mb-1 mt-2.5 block font-headline text-[30px] font-extrabold tracking-[-0.02em] text-gold">
          {stats.bestDps > 0 ? formatDps(stats.bestDps) : '—'}
        </b>
        {stats.bestJob && (
          <a
            href={`/sim/${stats.bestJob.id}`}
            className="mt-1 block text-sm font-semibold text-on-surface hover:text-gold hover:underline"
          >
            {stats.bestJob.player_name}
            {stats.bestJob.realm ? `-${stats.bestJob.realm}` : ''}
          </a>
        )}
        {stats.bestJob && (
          <p className="mt-1 text-xs text-outline">
            {stats.bestJob.fight_style} · ±{stats.bestJob.precise_error_pct}%
          </p>
        )}
        <span className="mt-1 block text-[12.5px] text-outline">
          {stats.bestJob ? t('sims.statBestDpsSub') : 'No character result with verified precision'}
        </span>
      </section>
    </div>
  );
}
