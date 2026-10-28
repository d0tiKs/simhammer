import { useState } from 'react';
import Link from 'next/link';
import type { JobOverviewSummary } from '../../lib/api';
import { isActiveStatus } from '../../lib/useActiveSims';
import { useLanguage } from '../../lib/i18n';
import { formatDps } from '../../lib/format';
import {
  durationLabel,
  gainVsEquipped,
  groupRuns,
  rotationLabel,
  scenarioDifferences,
  targetLabel,
} from '../../lib/runLibrary';
import { JobActionButtons } from './JobActionButtons';
import { SIM_TYPE_LABELS, SIM_TYPE_PILL, StatusDot, timeAgo } from './shared';
import Button from '../../components/ui/Button';
import Pill from '../../components/ui/Pill';

interface Props {
  jobs: JobOverviewSummary[];
  loading: boolean;
  grouped: boolean;
  busy: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}
function settingValue(value: unknown): string {
  if (value === true) return 'On';
  if (value === false) return 'Off';
  if (value == null) return 'Off';
  if (typeof value === 'object') {
    const item = value as { name?: string; value?: string };
    if (item.name) return item.name;
    return Object.entries(value)
      .map(([key, v]) => `${key.replaceAll('_', ' ')}: ${settingValue(v)}`)
      .join(' · ');
  }
  return String(value);
}
export function AllView({
  jobs,
  loading,
  grouped,
  busy,
  onPause,
  onResume,
  onCancel,
  onDelete,
}: Props) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleSettings = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  if (loading) return <div className="py-8 text-center text-outline">Loading runs…</div>;
  if (!jobs.length)
    return <div className="card p-8 text-center text-outline">No runs match these filters.</div>;
  const groups = groupRuns(jobs, grouped);
  return (
    <section className="space-y-3">
      {groups.map((group) => (
        <div
          key={group.key}
          role="group"
          aria-label={group.label || 'Recent runs'}
          className="card overflow-hidden px-4 sm:px-6"
        >
          {group.label && (
            <h2 className="-mx-4 border-b border-line/[0.1] bg-surface-container-high/60 px-4 py-2.5 text-sm font-semibold text-gold sm:-mx-6 sm:px-6">
              {group.label} <span className="font-normal text-outline">({group.jobs.length})</span>
              {group.jobs[0].scenario?.simc_revision && (
                <span className="mt-1 block break-all text-xs font-normal text-outline">
                  SimC commit: {group.jobs[0].scenario.simc_revision}
                </span>
              )}
              {scenarioDifferences(group.jobs[0], jobs) && (
                <span className="mt-1 block text-xs font-normal text-outline">
                  {scenarioDifferences(group.jobs[0], jobs)}
                </span>
              )}
            </h2>
          )}
          {group.jobs.map((job, index) => {
            const scenario = job.scenario;
            const gain = gainVsEquipped(job);
            return (
              <article
                key={job.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line/[0.06] py-3 last:border-0 md:grid-cols-[minmax(0,1fr)_auto_auto]"
              >
                {job.batch_id && job.batch_id !== group.jobs[index - 1]?.batch_id && (
                  <p className="col-span-full mb-1 text-xs text-gold">
                    Batch · {SIM_TYPE_LABELS[job.sim_type] ?? job.sim_type}
                  </p>
                )}
                <div className="contents">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        href={`/sim/${job.id}`}
                        className="flex items-center gap-2 font-bold text-on-surface hover:text-gold"
                      >
                        <StatusDot status={job.status} />
                        <span className="truncate">{job.player_name || t('sims.simulation')}</span>
                      </Link>
                      <div className="leading-none">
                        <Pill variant={SIM_TYPE_PILL[job.sim_type] ?? 'neutral'}>
                          {SIM_TYPE_LABELS[job.sim_type] ?? job.sim_type}
                        </Pill>
                      </div>
                    </div>
                    {!grouped && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="text-on-surface">{job.fight_style}</span>
                        <span className="font-semibold text-gold">{targetLabel(job)}</span>
                        <span className="text-outline">
                          {durationLabel(scenario?.duration)}
                          {scenario?.variation != null
                            ? ` ±${Math.round(scenario.variation * 100)}%`
                            : ''}
                        </span>
                        <span className="text-outline">{rotationLabel(scenario?.rotation)}</span>
                        {scenario?.simc_revision && (
                          <span className="break-all text-outline">SimC commit: {scenario.simc_revision}</span>
                        )}
                      </div>
                    )}
                    {job.error_message && (
                      <p className="mt-1 break-words text-xs text-negative">
                        {job.error_message.slice(0, 160)}
                      </p>
                    )}
                  </div>
                  <div className="text-right tabular-nums md:flex md:items-baseline md:gap-3">
                    <Link
                      href={`/sim/${job.id}`}
                      className="font-headline text-lg font-extrabold text-on-surface hover:text-gold"
                    >
                      {job.dps != null ? formatDps(job.precise_dps ?? job.dps) : '—'}{' '}
                      <span className="text-xs font-normal text-outline">DPS</span>
                    </Link>
                    {gain != null && (
                      <p
                        className={`mt-1 text-xs ${gain >= 0 ? 'text-positive' : 'text-negative'}`}
                      >
                        {gain >= 0 ? '+' : ''}
                        {gain.toFixed(1)}% vs equipped
                      </p>
                    )}
                    <p className="mt-1 text-xs text-outline md:mt-0">
                      {job.precise_dps == null
                        ? job.dps == null
                          ? job.status
                          : scenario?.achieved_error_pct != null
                            ? `±${scenario.achieved_error_pct}% · ${scenario.target_error === 0 ? 'Fixed iterations' : 'Above target'}`
                            : 'Estimate'
                        : `±${job.precise_error_pct}% error`}
                    </p>
                    <p className="mt-1 text-xs text-outline md:mt-0">
                      {timeAgo(job.created_at, t)}
                    </p>
                  </div>
                </div>
                <div className="col-span-full flex flex-wrap items-start justify-between gap-3 md:col-span-1 md:items-center">
                  <button
                    type="button"
                    aria-expanded={expanded.has(job.id)}
                    aria-controls={`settings-${job.id}`}
                    onClick={() => toggleSettings(job.id)}
                    className="inline-flex items-center gap-1 py-1 text-xs text-outline hover:text-on-surface"
                  >
                    <span aria-hidden="true" className="inline-block w-3">
                      {expanded.has(job.id) ? '▾' : '▸'}
                    </span>
                    Settings
                  </button>
                  {isActiveStatus(job.status) ? (
                    <JobActionButtons
                      job={job}
                      busy={busy === job.id}
                      onPause={() => onPause(job.id)}
                      onResume={() => onResume(job.id)}
                      onCancel={() => onCancel(job.id)}
                      compact
                    />
                  ) : (
                    <Button
                      disabled={busy === job.id}
                      onClick={() => onDelete(job.id)}
                      title={t('sims.deleteFromHistory')}
                      variant="text"
                      size="sm"
                      className="hover:text-negative"
                    >
                      ✕
                    </Button>
                  )}
                </div>
                {expanded.has(job.id) && (
                  <dl
                    id={`settings-${job.id}`}
                    className="col-span-full mt-2 min-w-0 space-y-1 break-words rounded bg-surface-container-high/50 p-3 text-xs text-outline"
                  >
                    <div>
                      <dt className="inline text-on-surface">Character: </dt>
                      <dd className="inline">
                        {job.player_name}
                        {job.realm ? `-${job.realm}` : ''} · {job.player_class ?? 'Spec unknown'}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-on-surface">Duration variation: </dt>
                      <dd className="inline">
                        {scenario?.variation == null
                          ? 'Not recorded'
                          : `±${Math.round(scenario.variation * 100)}%`}
                      </dd>
                    </div>
                    {Object.entries(scenario?.settings ?? {}).map(([key, value]) => (
                      <div key={key}>
                        <dt className="inline text-on-surface">{key.replaceAll('_', ' ')}: </dt>
                        <dd className="inline">{settingValue(value)}</dd>
                      </div>
                    ))}
                    <div>
                      <dt className="inline text-on-surface">SimC revision: </dt>
                      <dd className="inline">{scenario?.simc_revision ?? 'Not recorded'}</dd>
                    </div>
                    <div>
                      <dt className="inline text-on-surface">Iterations: </dt>
                      <dd className="inline">
                        {scenario?.actual_iterations != null
                          ? `${scenario.actual_iterations.toLocaleString()} completed`
                          : `${job.iterations.toLocaleString()} requested`}
                      </dd>
                    </div>
                    <div>
                      <Link href={`/sim/${job.id}`} className="text-gold hover:underline">
                        Open full report →
                      </Link>
                    </div>
                  </dl>
                )}
              </article>
            );
          })}
        </div>
      ))}
    </section>
  );
}
