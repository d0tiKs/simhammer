'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL } from '../../lib/api';
import type { TopGearResult } from './topGearResultsTypes';
import Button from '../ui/Button';
import { refinementCandidates } from './refinementCandidates';

export interface RefinementInfo {
  source_id: string;
  mode?: 'probability' | 'auto' | 'custom';
  min_probability_pct?: number;
  margin_pct: number;
  target_error: number;
  combinations: string[];
}

export default function RefineRankings({
  sourceJobId,
  useEquippedBaseline,
  results,
  targetError,
  refinement,
}: {
  sourceJobId?: string;
  useEquippedBaseline?: boolean;
  results: TopGearResult[];
  targetError?: number;
  refinement?: RefinementInfo;
}) {
  const router = useRouter();
  const [margin, setMargin] = useState('0');
  const [mode, setMode] = useState<'probability' | 'auto' | 'custom'>('probability');
  const [probability, setProbability] = useState('20');
  const probabilityValue = Number(probability);
  const probabilityValid =
    probability.trim() !== '' &&
    Number.isFinite(probabilityValue) &&
    probabilityValue >= 0 &&
    probabilityValue <= 100;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const value = Number(margin);
  const valid =
    mode === 'probability'
      ? probabilityValid
      : mode === 'auto' ||
        (margin.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 10);
  const candidates = refinementCandidates(
    results,
    targetError,
    mode === 'auto' ? 0 : valid ? value : 0,
    mode,
    probabilityValid ? probabilityValue : 20,
    useEquippedBaseline
  );
  if (!sourceJobId) return null;
  if (
    useEquippedBaseline &&
    !refinement &&
    targetError &&
    !results.some(
      (row) =>
        /^Combo \d+$/.test(row.name) &&
        (row.precision_pct == null || row.precision_pct > targetError + 0.005)
    )
  )
    return null;
  return (
    <div className="border-t border-line/10 px-3 py-3 text-sm sm:px-4">
      {refinement && (
        <p className="mb-2 text-xs text-outline">
          Refined {refinement.combinations.length} combinations at ±{refinement.target_error}% using{' '}
          {refinement.mode === 'probability'
            ? `a ${refinement.min_probability_pct ?? 20}% minimum estimated improvement probability`
            : refinement.mode === 'auto'
              ? 'automatic error-range selection'
              : `a ${refinement.margin_pct}% margin`}
          .{' '}
          <a href={`/sim/${refinement.source_id}`} className="text-gold underline">
            Original report
          </a>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-on-surface">
          Selection
          <select
            aria-label="Refinement selection"
            value={mode}
            disabled={busy}
            onChange={(event) => setMode(event.target.value as 'probability' | 'auto' | 'custom')}
            className="rounded border border-line/20 bg-surface px-2 py-1"
          >
            <option value="probability">Probability</option>
            <option value="auto">Auto · error ranges</option>
            <option value="custom">Custom margin</option>
          </select>
        </label>
        {mode === 'probability' && (
          <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-on-surface">
            Minimum chance
            <input
              aria-label="Minimum estimated improvement probability"
              type="number"
              min="0"
              max="100"
              step="1"
              value={probability}
              disabled={busy}
              onChange={(event) => setProbability(event.target.value)}
              className="w-16 rounded border border-line/20 bg-surface px-2 py-1"
            />
            %
          </label>
        )}
        {mode === 'custom' && (
          <label className="flex flex-wrap items-center gap-2 text-xs text-on-surface">
            Include rough results within
            <input
              aria-label="Margin below the reference result"
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={margin}
              disabled={busy}
              onChange={(event) => setMargin(event.target.value)}
              className="w-16 rounded border border-line/20 bg-surface px-2 py-1"
            />
            % below{' '}
            {useEquippedBaseline ? 'currently equipped gear' : 'the best full-precision result'}
          </label>
        )}
        <Button
          size="sm"
          disabled={busy || !valid || !candidates?.length}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const response = await fetch(`${API_URL}/api/sim/${sourceJobId}/refine`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  mode,
                  margin_pct: mode === 'custom' ? value : 0,
                  min_probability_pct: mode === 'probability' ? probabilityValue : 20,
                }),
              });
              const data = await response.json();
              if (!response.ok) throw new Error(data.detail || 'Could not start refinement');
              router.push(`/sim/${data.id}`);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not start refinement');
              setBusy(false);
            }
          }}
        >
          {busy
            ? 'Starting…'
            : !valid
              ? 'Enter a valid threshold'
              : `Refine ${candidates?.length.toLocaleString() ?? 0} combinations`}
        </Button>
      </div>
      <p aria-live="polite" aria-atomic="true" className="mt-1 text-xs text-on-surface">
        {valid
          ? `${candidates?.length.toLocaleString() ?? 0} combinations selected for refinement`
          : 'Enter a valid threshold to calculate the count'}
      </p>
      <p className="mt-1 text-xs text-outline">
        {mode === 'probability'
          ? 'Estimated using a normal approximation and both results’ uncertainty. This is a screening score, not a calibrated probability. Results without error data are excluded.'
          : mode === 'auto'
            ? `Auto selects rough results whose error ranges overlap or exceed ${useEquippedBaseline ? 'currently equipped gear' : 'the best full-precision result'}. Results with unknown error are included.`
            : 'Wider margins include more results.'}{' '}
        Check the count before starting; more combinations take longer. Creates a new report at ±
        {targetError}% using the source settings and the same SimC revision.
      </p>
      {candidates === null && (
        <p className="mt-1 text-xs text-outline">
          {useEquippedBaseline
            ? 'The equipped baseline has no full-precision result.'
            : 'No full-precision result is available as a reference.'}
        </p>
      )}
      {!valid && (
        <p role="alert" className="mt-1 text-xs text-negative">
          {mode === 'probability'
            ? 'Enter a probability between 0 and 100%.'
            : 'Enter a margin between 0 and 10%.'}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
