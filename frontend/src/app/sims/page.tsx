'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  API_URL,
  deleteJob,
  ShareRevokeError,
  fetchAllJobs,
  pauseSim,
  resumeSim,
  type JobOverviewSummary,
} from '../lib/api';
import { isActiveStatus, useActiveSims } from '../lib/useActiveSims';
import { useSimContext } from '../components/sim-config/SimContext';
import { blizzardRealmSlug, parseCharacterInfo } from '../lib/character';
import { scenarioKey, scenarioLabel, rotationLabel, scenarioDifferences } from '../lib/runLibrary';
import { SIM_TYPE_LABELS } from './_components/shared';
import { getCharacters } from '../lib/saved-characters';
import { useLanguage } from '../lib/i18n';
import { ActiveView } from './_components/ActiveView';
import { AllView } from './_components/AllView';
import { StatsOverview } from './_components/StatsOverview';
import PageHeader from '../components/ui/PageHeader';
import ToggleButtonGroup from '../components/ui/ToggleButtonGroup';

type ViewMode = 'active' | 'all';

type CharacterFilter = { name: string; realm: string | null; region?: string | null };
const characterKey = (value: CharacterFilter) =>
  JSON.stringify([value.name.toLowerCase(), blizzardRealmSlug(value.realm ?? '')]);

export default function SimsPage() {
  const { t } = useLanguage();
  const {
    jobs: activeSnapshot,
    error: pollError,
    refresh: refreshActive,
    setPauseRequested,
  } = useActiveSims();
  const { simcInput } = useSimContext();
  const [allJobs, setAllJobs] = useState<JobOverviewSummary[]>([]);
  const [allLoading, setAllLoading] = useState(true);
  const [allError, setAllError] = useState<string | null>(null);
  const character = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);
  const [filterCharacter, setFilterCharacter] = useState<CharacterFilter | null>(character);
  const [knownCharacters, setKnownCharacters] = useState<CharacterFilter[]>([]);
  useEffect(() => {
    setFilterCharacter(character);
    // Only a change of character in the header resets the local selector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character?.name, character?.realm, character?.region]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([getCharacters(), fetchAllJobs().catch(() => [])])
      .then(([saved, jobs]) => {
        if (cancelled) return;
        setKnownCharacters([
          ...saved,
          ...jobs
            .filter((job) => job.player_name)
            .map((job) => ({
              name: job.player_name!,
              realm: job.realm,
              region: job.region,
            })),
        ]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const characterOptions = useMemo(() => {
    const options = new Map<string, CharacterFilter>();
    for (const entry of [
      ...knownCharacters,
      ...activeSnapshot
        .filter((job) => job.player_name)
        .map((job) => ({
          name: job.player_name!,
          realm: job.realm,
          region: job.region,
        })),
      ...(character ? [character] : []),
      ...(filterCharacter ? [filterCharacter] : []),
    ])
      options.set(characterKey(entry), entry);
    return [...options.values()].sort((a, b) =>
      `${a.name}-${a.realm}`.localeCompare(`${b.name}-${b.realm}`)
    );
  }, [knownCharacters, activeSnapshot, character, filterCharacter]);
  const [view, setView] = useState<ViewMode>('all');
  const [grouped, setGrouped] = useState(true);
  const [scenarioFilter, setScenarioFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [rotationFilter, setRotationFilter] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Apply the same scope to history, live polling, counts and best DPS.
  const matchesCharacter = useCallback(
    (job: JobOverviewSummary) =>
      !filterCharacter ||
      (job.player_name?.toLowerCase() === filterCharacter.name.toLowerCase() &&
        (!filterCharacter.realm ||
          blizzardRealmSlug(job.realm ?? '') === blizzardRealmSlug(filterCharacter.realm)) &&
        (!job.region ||
          !filterCharacter.region ||
          job.region.toLowerCase() === filterCharacter.region.toLowerCase())),
    [filterCharacter]
  );

  const loadAllJobs = useCallback(() => {
    setAllLoading(true);
    setAllError(null);
    fetchAllJobs(
      filterCharacter
        ? { player: filterCharacter.name, realm: filterCharacter.realm ?? undefined }
        : {}
    )
      .then((data) => setAllJobs(Array.isArray(data) ? data : []))
      .catch((e) => {
        setAllJobs([]);
        setAllError(e instanceof Error ? e.message : t('sims.errLoadHistory'));
      })
      .finally(() => setAllLoading(false));
  }, [filterCharacter, t]);

  useEffect(() => {
    loadAllJobs();
  }, [loadAllJobs]);

  // Merge live polling data over the snapshot so active rows in the All view
  // reflect progress updates without requiring a manual refresh.
  const mergedJobs = useMemo(() => {
    const liveById = new Map(activeSnapshot.map((j) => [j.id, j]));
    const merged = allJobs.map((j) => liveById.get(j.id) ?? j);
    for (const live of activeSnapshot) {
      if (!merged.some((j) => j.id === live.id)) {
        merged.unshift(live);
      }
    }
    return merged.filter(matchesCharacter);
  }, [activeSnapshot, allJobs, matchesCharacter]);

  const scenarioOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const job of mergedJobs)
      options.set(
        scenarioKey(job),
        [scenarioLabel(job), scenarioDifferences(job, mergedJobs)].filter(Boolean).join(' · ')
      );
    return [...options.entries()];
  }, [mergedJobs]);
  const simTypes = [...new Set(mergedJobs.map((job) => job.sim_type))];
  const rotations = [...new Set(mergedJobs.map((job) => job.scenario?.rotation ?? 'unknown'))];
  const visibleJobs = useMemo(
    () =>
      mergedJobs.filter(
        (job) =>
          (scenarioFilter === 'all' || scenarioKey(job) === scenarioFilter) &&
          (typeFilter === 'all' || job.sim_type === typeFilter) &&
          (rotationFilter === 'all' || (job.scenario?.rotation ?? 'unknown') === rotationFilter)
      ),
    [mergedJobs, scenarioFilter, typeFilter, rotationFilter]
  );
  const activeList = visibleJobs.filter((job) => isActiveStatus(job.status));
  useEffect(() => {
    setScenarioFilter('all');
    setTypeFilter('all');
    setRotationFilter('all');
  }, [filterCharacter]);

  const refreshAll = useCallback(() => {
    refreshActive();
    loadAllJobs();
  }, [refreshActive, loadAllJobs]);

  const wrapAction = useCallback(
    async (id: string, fn: () => Promise<void>, errorPrefix: string) => {
      setBusy(id);
      setActionError(null);
      try {
        await fn();
        refreshAll();
      } catch (e: unknown) {
        setActionError(e instanceof Error ? e.message : errorPrefix);
      } finally {
        setBusy(null);
      }
    },
    [refreshAll]
  );

  const handlePause = useCallback(
    async (id: string) => {
      setPauseRequested(id, true);
      setBusy(id);
      setActionError(null);
      try {
        await pauseSim(id);
        refreshAll();
      } catch (e: unknown) {
        setPauseRequested(id, false);
        setActionError(e instanceof Error ? e.message : t('sims.errPause'));
      } finally {
        setBusy(null);
      }
    },
    [refreshAll, setPauseRequested, t]
  );
  const handleResume = useCallback(
    (id: string) => wrapAction(id, () => resumeSim(id), t('sims.errResume')),
    [wrapAction, t]
  );
  const handleCancel = useCallback(
    (id: string) => {
      if (!window.confirm(t('sims.confirmCancel'))) return;
      wrapAction(
        id,
        async () => {
          const res = await fetch(`${API_URL}/api/sim/${id}/cancel`, { method: 'POST' });
          if (!res.ok) {
            const detail = await res.json().catch(() => ({}));
            throw new Error(detail.detail || t('sims.errCancelStatus', { status: res.status }));
          }
        },
        t('sims.errCancel')
      );
    },
    [wrapAction, t]
  );
  const handleDelete = useCallback(
    (id: string) => {
      if (!window.confirm(t('sims.confirmDelete'))) return;
      wrapAction(
        id,
        async () => {
          try {
            await deleteJob(id);
          } catch (e) {
            if (!(e instanceof ShareRevokeError)) throw e;
            // Declining keeps the sim; that is the user's choice, not an error.
            if (window.confirm(t('sims.confirmDeleteShared'))) await deleteJob(id, true);
          }
        },
        t('sims.errDelete')
      );
    },
    [wrapAction, t]
  );

  const error = actionError ?? pollError ?? allError;

  return (
    <div className="space-y-5 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          eyebrow={t('nav.library')}
          title={t('sims.title')}
          subtitle={t('sims.description')}
        />
        <ToggleButtonGroup<ViewMode>
          value={view}
          onChange={setView}
          options={[
            { key: 'active', label: t('sims.tabActive', { count: activeList.length }) },
            { key: 'all', label: t('sims.tabAll', { count: visibleJobs.length }) },
          ]}
        />
      </div>

      {error && (
        <div className="rounded-[6px] border border-negative/25 bg-negative/[0.08] px-3 py-2 text-[13px] text-negative">
          {error}
        </div>
      )}

      <StatsOverview sims={visibleJobs} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-w-0 flex-wrap items-center gap-3 text-sm text-outline">
          Character
          <select
            className="min-w-0 max-w-full rounded border border-outline/30 bg-surface-container px-3 py-2 text-on-surface"
            value={filterCharacter ? characterKey(filterCharacter) : 'all'}
            onChange={(event) =>
              setFilterCharacter(
                characterOptions.find((entry) => characterKey(entry) === event.target.value) ?? null
              )
            }
          >
            {characterOptions.map((entry) => (
              <option key={characterKey(entry)} value={characterKey(entry)}>
                {entry.name}
                {entry.realm ? `-${entry.realm}` : ''}
              </option>
            ))}
            <option value="all">All characters</option>
          </select>
        </label>
        <ToggleButtonGroup
          value={grouped ? 'scenario' : 'recent'}
          onChange={(value) => setGrouped(value === 'scenario')}
          options={[
            { key: 'recent', label: 'Recent' },
            { key: 'scenario', label: 'By scenario' },
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="min-w-0 text-xs text-outline">
          Scenario
          <select
            className="mt-1 w-full rounded border border-outline/30 bg-surface-container px-2 py-2 text-sm text-on-surface"
            value={scenarioFilter}
            onChange={(e) => setScenarioFilter(e.target.value)}
          >
            <option value="all">All scenarios</option>
            {scenarioOptions.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-xs text-outline">
          Sim type
          <select
            className="mt-1 w-full rounded border border-outline/30 bg-surface-container px-2 py-2 text-sm text-on-surface"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">All sim types</option>
            {simTypes.map((type) => (
              <option key={type} value={type}>
                {SIM_TYPE_LABELS[type] ?? type}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-xs text-outline">
          Rotation
          <select
            className="mt-1 w-full rounded border border-outline/30 bg-surface-container px-2 py-2 text-sm text-on-surface"
            value={rotationFilter}
            onChange={(e) => setRotationFilter(e.target.value)}
          >
            <option value="all">All rotations</option>
            {rotations.map((rotation) => (
              <option key={rotation} value={rotation}>
                {rotationLabel(rotation === 'unknown' ? null : rotation)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-outline" aria-live="polite">
        Showing {view === 'active' ? activeList.length : visibleJobs.length} of {mergedJobs.length}{' '}
        runs
      </p>

      {view === 'active' ? (
        <ActiveView
          jobs={activeList}
          busy={busy}
          onPause={handlePause}
          onResume={handleResume}
          onCancel={handleCancel}
        />
      ) : (
        <AllView
          jobs={visibleJobs}
          grouped={grouped}
          loading={allLoading}
          busy={busy}
          onPause={handlePause}
          onResume={handleResume}
          onCancel={handleCancel}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
