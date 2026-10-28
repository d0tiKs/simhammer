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
import { useLanguage } from '../lib/i18n';
import { ActiveView } from './_components/ActiveView';
import { AllView } from './_components/AllView';
import { StatsOverview } from './_components/StatsOverview';
import PageHeader from '../components/ui/PageHeader';
import ToggleButtonGroup from '../components/ui/ToggleButtonGroup';

type ViewMode = 'active' | 'all';

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
  const [showAllCharacters, setShowAllCharacters] = useState(false);
  useEffect(
    () => setShowAllCharacters(false),
    [character?.name, character?.realm, character?.region]
  );
  const filterCharacter = showAllCharacters ? null : character;
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
        (!job.region || job.region.toLowerCase() === filterCharacter.region.toLowerCase())),
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
          value={showAllCharacters || !character ? 'all' : 'selected'}
          onChange={(event) => setShowAllCharacters(event.target.value === 'all')}
        >
          {character && (
            <option value="selected">
              {character.name}
              {character.realm ? `-${character.realm}` : ''} (selected above)
            </option>
          )}
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
