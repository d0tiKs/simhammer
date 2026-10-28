import type { JobOverviewSummary } from './api';

export function rotationLabel(rotation?: string | null): string {
  return (
    (
      {
        default: 'Standard',
        assisted_combat: 'Assisted Combat',
        one_button: 'One-button',
        custom: 'Custom',
      } as Record<string, string>
    )[rotation ?? ''] ??
    rotation ??
    'Rotation unknown'
  );
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)])
    );
  return value;
}
export function scenarioKey(job: JobOverviewSummary): string {
  const s = job.scenario;
  return JSON.stringify(
    canonical({
      fight: job.fight_style,
      targets: s?.targets ?? null,
      duration: s?.duration ?? null,
      variation: s?.variation ?? null,
      rotation: s?.rotation ?? null,
      settings: Object.fromEntries(
        Object.entries(s?.settings ?? {}).filter(([, value]) => value !== '' && value != null)
      ),
      revision: s?.simc_revision ?? null,
    })
  );
}
export function durationLabel(seconds?: number | null): string {
  if (seconds == null) return 'Duration unknown';
  const m = Math.floor(seconds / 60),
    s = seconds % 60;
  return [m ? `${m}m` : '', s ? `${s}s` : ''].filter(Boolean).join(' ') || '0s';
}
export function targetLabel(job: JobOverviewSummary): string {
  const n = job.scenario?.targets;
  return job.fight_style === 'DungeonSlice' || job.fight_style === 'DungeonRoute'
    ? 'Dynamic targets'
    : n == null
      ? 'Targets unknown'
      : `${n} target${n === 1 ? '' : 's'}`;
}
export function scenarioLabel(job: JobOverviewSummary): string {
  return [
    job.fight_style,
    targetLabel(job),
    durationLabel(job.scenario?.duration),
    job.scenario?.variation != null ? `±${Math.round(job.scenario.variation * 100)}%` : null,
    rotationLabel(job.scenario?.rotation),
  ]
    .filter(Boolean)
    .join(' · ');
}
export function groupRuns(jobs: JobOverviewSummary[], grouped: boolean) {
  if (!grouped) return [{ key: 'recent', label: '', jobs }];
  const groups = new Map<string, { key: string; label: string; jobs: JobOverviewSummary[] }>();
  for (const job of jobs) {
    const key = scenarioKey(job);
    if (!groups.has(key)) groups.set(key, { key, label: scenarioLabel(job), jobs: [] });
    groups.get(key)!.jobs.push(job);
  }
  return [...groups.values()];
}
export function gainVsEquipped(job: JobOverviewSummary): number | null {
  const s = job.scenario;
  if (
    !s?.baseline_dps ||
    job.precise_dps == null ||
    s.baseline_error_pct == null ||
    s.target_error == null ||
    s.baseline_error_pct > s.target_error + 0.005
  )
    return null;
  return (job.precise_dps / s.baseline_dps - 1) * 100;
}

/** Describe only environment differences between otherwise identically labelled groups. */
export function scenarioDifferences(job: JobOverviewSummary, peers: JobOverviewSummary[]): string {
  const flatten = (j: JobOverviewSummary) => {
    const entries: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(j.scenario?.settings ?? {})) {
      if (value == null || value === '') continue;
      if ((key === 'consumables' || key === 'raid_buffs') && value && typeof value === 'object') {
        for (const [part, detail] of Object.entries(value)) entries[part] = detail;
      } else entries[key] = value;
    }
    entries['SimC revision'] = j.scenario?.simc_revision;
    return entries;
  };
  const sameLabel = peers.filter((j) => scenarioLabel(j) === scenarioLabel(job));
  if (sameLabel.length < 2) return '';
  const current = flatten(job),
    others = sameLabel.map(flatten);
  const keys = [...new Set(others.flatMap(Object.keys))];
  const differing = keys.filter(
    (key) =>
      new Set(others.map((value) => JSON.stringify(canonical(value[key] ?? '__unknown__')))).size >
      1
  );
  const buffs = job.scenario?.settings.raid_buffs as Record<string, boolean> | undefined;
  const buffKeys = new Set(
    others
      .flatMap((value) => Object.keys(value))
      .filter((key) =>
        sameLabel.some((j) => key in ((j.scenario?.settings.raid_buffs ?? {}) as object))
      )
  );
  const consumableKeys = new Set(['flask', 'potion', 'food', 'augmentation', 'weapon_rune']);
  const summary: string[] = [];
  if (differing.some((key) => buffKeys.has(key))) {
    if (!buffs) summary.push('Buffs not recorded');
    else {
      const on = Object.values(buffs).filter((value) => value === true).length;
      const off = Object.values(buffs).filter((value) => value === false).length;
      summary.push(`${on} ${on === 1 ? 'buff' : 'buffs'} on${off ? ` · ${off} off` : ''}`);
    }
  }
  const consumableDiffs = differing.filter((key) => consumableKeys.has(key));
  const groupedConsumables = consumableDiffs.length >= 3;
  if (groupedConsumables) {
    const values = Object.values(
      (job.scenario?.settings.consumables ?? {}) as Record<string, unknown>
    );
    const on = values.filter(Boolean).length;
    summary.push(
      values.length ? (on ? `${on} consumables on` : 'Consumables off') : 'Consumables not recorded'
    );
  }
  for (const key of differing) {
    if (buffKeys.has(key) || (groupedConsumables && consumableKeys.has(key))) continue;
    const value = current[key];
    const label = key.replaceAll('_', ' ');
    const display =
      value === undefined
        ? 'Not recorded'
        : value === null
          ? consumableKeys.has(key)
            ? 'Off'
            : 'Not recorded'
          : typeof value === 'boolean'
            ? value
              ? 'On'
              : 'Off'
            : typeof value === 'object'
              ? ((value as { name?: string }).name ??
                (value as { value?: string }).value ??
                'Custom')
              : String(value);
    summary.push(`${label.charAt(0).toUpperCase() + label.slice(1)}: ${display}`);
  }
  return summary.length > 3
    ? `${summary.slice(0, 3).join(' · ')} · +${summary.length - 3} settings`
    : summary.join(' · ');
}
