'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../../lib/api';
import Button from '../ui/Button';

/** Fetch the saved run input, not the character currently selected in the header. */
export default function CopySimcInputButton({ jobId }: { jobId: string }) {
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    setState('copying');
    clearTimeout(timer.current);
    try {
      const input = fetch(`${API_URL}/api/sim/${encodeURIComponent(jobId)}/input`).then(
        async (response) => {
          if (!response.ok) throw new Error('Could not load saved SimC input');
          return response.text();
        }
      );
      // Safari requires clipboard.write to start during the click gesture.
      // Supplying a promised Blob keeps that gesture while input is fetched.
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': input.then((text) => new Blob([text], { type: 'text/plain' })),
          }),
        ]);
      } else {
        const text = await input;
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
      }
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('error');
    }
  };

  return (
    <span className="relative inline-flex">
      <Button
        variant="quiet"
        onClick={copy}
        disabled={state === 'copying'}
        title="Copy this run's saved SimC input"
        aria-label={state === 'copied' ? 'SimC input copied' : 'Copy SimC input'}
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <rect x="7" y="7" width="10" height="10" rx="2" />
          <path d="M12 7V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3" />
        </svg>
        <span className="hidden sm:inline" aria-live="polite">
          {state === 'copied' ? 'Copied!' : state === 'copying' ? 'Copying…' : 'Copy input'}
        </span>
      </Button>
      {state === 'error' && (
        <span
          role="alert"
          className="popover absolute right-0 top-full z-30 mt-2 w-64 rounded p-3 text-xs normal-case tracking-normal text-negative"
        >
          Could not copy. Allow clipboard access and try again, or use the Raw input link.
        </span>
      )}
    </span>
  );
}
