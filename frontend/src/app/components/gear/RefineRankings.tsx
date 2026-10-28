'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL } from '../../lib/api';
import type { TopGearResult } from './topGearResultsTypes';
import Button from '../ui/Button';
import { refinementCandidates } from './refinementCandidates';

export interface RefinementInfo {
  source_id: string;
  margin_pct: number;
  target_error: number;
  combinations: string[];
}

export default function RefineRankings({
  sourceJobId,
  results,
  targetError,
  refinement,
}: {
  sourceJobId?: string;
  results: TopGearResult[];
  targetError?: number;
  refinement?: RefinementInfo;
}) {
  const router = useRouter();
  const [margin, setMargin] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const value = Number(margin);
  const valid = margin.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 10;
  const candidates = refinementCandidates(results, targetError, valid ? value : 0);
  if (!sourceJobId) return null;
  return (
    <div className="border-t border-line/10 px-3 py-3 text-sm sm:px-4">
      {refinement && (
        <p className="mb-2 text-xs text-outline">
          Refined {refinement.combinations.length} combinations at ±{refinement.target_error}% with
          a {refinement.margin_pct}% margin.{' '}
          <a href={`/sim/${refinement.source_id}`} className="text-gold underline">
            Original report
          </a>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-wrap items-center gap-2 text-xs text-on-surface">
          Include rough results within
          <input
            aria-label="Margin below the best full-precision result"
            type="number"
            min="0"
            max="10"
            step="0.1"
            value={margin}
            disabled={busy}
            onChange={(event) => setMargin(event.target.value)}
            className="w-16 rounded border border-line/20 bg-surface px-2 py-1"
          />
          % below the best full-precision result
        </label>
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
                body: JSON.stringify({ margin_pct: value }),
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
          {busy ? 'Starting…' : `Refine ${candidates?.length.toLocaleString() ?? 0} combinations`}
        </Button>
      </div>
      <p className="mt-1 text-xs text-outline">
        Creates a new report at ±{targetError}% using the source settings. Wider margins take
        longer. Requires the same SimC revision.
      </p>
      {candidates === null && (
        <p className="mt-1 text-xs text-outline">
          No full-precision result is available as a reference.
        </p>
      )}
      {!valid && (
        <p role="alert" className="mt-1 text-xs text-negative">
          Enter a margin between 0 and 10%.
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
