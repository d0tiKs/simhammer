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
  const [view, setView] = useState<ViewMode>('active');
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

  const activeList = useMemo(
    () => activeSnapshot.filter((j) => isActiveStatus(j.status) && matchesCharacter(j)),
    [activeSnapshot, matchesCharacter]
  );

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
      <div className="flex items-end justify-between gap-6">
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
            { key: 'all', label: t('sims.tabAll', { count: mergedJobs.length }) },
          ]}
        />
      </div>

      {error && (
        <div className="rounded-[6px] border border-negative/25 bg-negative/[0.08] px-3 py-2 text-[13px] text-negative">
          {error}
        </div>
      )}

      <label className="flex flex-wrap items-center gap-3 text-sm text-outline">
        Character
        <select
          className="rounded border border-outline/30 bg-surface-container px-3 py-2 text-on-surface"
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
        <span>{mergedJobs.length} runs</span>
      </label>

      <StatsOverview sims={mergedJobs} />

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
          jobs={mergedJobs}
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
