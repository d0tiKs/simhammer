'use client';

import { useRouter } from 'next/navigation';
import { memo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { simRow } from '../../lib/api';
import {
  localizedEnchantName,
  localizedGemName,
  toGemIdList,
  type EnchantInfo,
  type GemInfo,
  type ItemInfo,
} from '../../lib/useItemInfo';
import { SLOT_LABELS } from '../../lib/types';
import { buildBestGearSet } from './topGearResultsUtils';
import { useLanguage } from '../../lib/i18n';
import type { ResultItem, TopGearResult } from './topGearResultsTypes';
import ComboSummary from './ComboSummary';
import Pill from '../ui/Pill';

/** Square icon button for a row's actions; shown on hover. */
const ROW_ACTION =
  'grid h-7 w-7 place-items-center rounded-[6px] border border-line/[0.08] text-outline transition-colors hover:border-line/20 disabled:opacity-50';

/** Numeric combo id from a "Combo N" name; null for other shapes (e.g. "Currently Equipped"). */
function comboIdFromName(name: string): number | null {
  const match = name.match(/^Combo (\d+)$/);
  return match ? Number(match[1]) : null;
}

/** Dot tone for precision (95% CI half-width as % of mean = how trustworthy the DPS is,
 * not what was targeted). Greener = tighter: ≤0.5 green, ≤1 emerald, ≤2 yellow, ≤4 orange, else red. */
function precisionDotTone(pct: number): string {
  if (pct <= 0.5) return 'bg-emerald-400';
  if (pct <= 1.0) return 'bg-emerald-500';
  if (pct <= 2.0) return 'bg-yellow-400';
  if (pct <= 4.0) return 'bg-orange-400';
  return 'bg-red-500';
}

/** Short band name shown as the precision tooltip header (mirrors the dot tone). */
function precisionBandLabel(
  pct: number,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (pct <= 0.5) return t('gear.precisionFinal');
  if (pct <= 1.0) return t('gear.precisionRefine');
  if (pct <= 2.0) return t('gear.precisionCoarse');
  if (pct <= 4.0) return t('gear.precisionProbe');
  return t('gear.precisionPrune');
}

/** Precision dot with hover card. Card is portal-rendered at a fixed position so it escapes
 * the row's `overflow-hidden` (DPS bar clip); a plain CSS popover would be cropped at the edge. */
function PrecisionDot({ pct, targetError }: { pct: number; targetError?: number }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setTip({ top: r.top, left: r.right });
  };

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => setTip(null)}
      className="flex items-center"
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${precisionDotTone(pct)}`}
        aria-label={t('gear.precisionAccuracy', { pct: pct.toFixed(2) })}
      />
      {tip &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: 'fixed', top: tip.top - 8, left: tip.left }}
            className="popover pointer-events-none z-[60] -translate-x-full -translate-y-full rounded-[6px] px-3 py-2"
          >
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${precisionDotTone(pct)}`} />
              <span className="whitespace-nowrap text-[11px] font-semibold text-on-surface">
                {precisionBandLabel(pct, t)}
              </span>
            </div>
            <div className="mt-1 whitespace-nowrap font-mono text-[11px] tabular-nums leading-tight text-on-surface-variant">
              ±{pct.toFixed(2)}% <span className="text-on-surface-variant/50">· 95% CI</span>
            </div>
            {targetError != null && (
              <div className="whitespace-nowrap font-mono text-[11px] tabular-nums leading-tight text-on-surface-variant/60">
                target {targetError.toFixed(2)}%
              </div>
            )}
          </div>,
          document.body
        )}
    </span>
  );
}

/** One simmed combination: what it changes, what it is worth, and the controls to
 *  compare or re-sim it. Shared by the ranked list and the per-source panels in the
 *  encounter summary, so a row reads the same wherever it is shown. */
export const ResultRow = memo(function ResultRow({
  result,
  equippedGear,
  rank,
  maxDps,
  baseDps,
  targetError,
  isBest,
  isSelected,
  onSelect,
  isCompareTarget,
  onCompare,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  sourceJobId,
}: {
  result: TopGearResult;
  equippedGear?: Record<string, ResultItem>;
  rank?: number;
  maxDps: number;
  baseDps: number;
  targetError?: number;
  isBest: boolean;
  isSelected?: boolean;
  onSelect?: (name: string) => void;
  isCompareTarget?: boolean;
  onCompare?: (name: string) => void;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  /** When present, "Combo N" rows show a "Sim" button re-running the combo as a Quick Sim. */
  sourceJobId?: string;
}) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [verifying, setVerifying] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const barWidth = maxDps > 0 ? (result.dps / maxDps) * 100 : 0;
  const comboId = comboIdFromName(result.name);
  const showVerifyButton = !!sourceJobId && comboId !== null;

  const changedItems = result.items.filter(
    (item) => !item.is_kept && item.item_id > 0 && !item.type
  );
  const enchantGemItems = result.items.filter(
    (item) => item.type === 'enchant' || item.type === 'gem'
  );
  const isEquipped =
    (result.items.length === 0 || result.name.startsWith('Currently Equipped')) &&
    enchantGemItems.length === 0;
  const gearSet = buildBestGearSet(equippedGear ?? {}, result);
  const detailChanges: string[] = [];
  const changeMarkers: Record<string, { enchant?: boolean; gem?: boolean; gemId?: number }> = {};
  if (equippedGear && !result.name.startsWith('Currently Equipped')) {
    for (const [slot, item] of Object.entries(gearSet)) {
      const before = equippedGear[slot];
      if (!before) continue;
      const slotName = SLOT_LABELS[slot] || slot;
      if ((item.enchant_id || 0) !== (before.enchant_id || 0)) {
        changeMarkers[slot] = { ...changeMarkers[slot], enchant: true };
        const enchant = item.enchant_id && enchantInfoMap[item.enchant_id];
        detailChanges.push(
          `${slotName}: ${item.enchant_id ? (enchant ? localizedEnchantName(enchant, locale) : `Enchant #${item.enchant_id}`) : 'Enchant removed'}`
        );
      }
      const gems = toGemIdList(item);
      if (gems.join(',') !== toGemIdList(before).join(',')) {
        changeMarkers[slot] = { ...changeMarkers[slot], gem: true, gemId: gems[0] };
        detailChanges.push(
          `${slotName}: ${gems.length ? gems.map((id) => (gemInfoMap[id] ? localizedGemName(gemInfoMap[id], locale) : `Gem #${id}`)).join(', ') : 'Gem removed'}`
        );
      }
    }
  } else if (!equippedGear) {
    for (const item of enchantGemItems) {
      changeMarkers[item.slot] = {
        ...changeMarkers[item.slot],
        [item.type!]: true,
        ...(item.type === 'gem' ? { gemId: item.gem_id } : {}),
      };
      detailChanges.push(`${SLOT_LABELS[item.slot] || item.slot}: ${item.name || item.type}`);
    }
  }
  const changedSlots = new Set(changedItems.map((item) => item.slot));
  const showBothRings = changedSlots.has('finger1') || changedSlots.has('finger2');
  const showBothTrinkets = changedSlots.has('trinket1') || changedSlots.has('trinket2');

  const displayItems = result.items
    .filter((item) => {
      if (item.type) return false;
      if (!item.is_kept) return item.item_id > 0;
      if (showBothRings && (item.slot === 'finger1' || item.slot === 'finger2')) return true;
      if (showBothTrinkets && (item.slot === 'trinket1' || item.slot === 'trinket2')) return true;
      return false;
    })
    .map((item) => {
      const applied = gearSet[item.slot];
      return applied && applied.item_id === item.item_id ? { ...item, ...applied } : item;
    });

  // Enchant-only and gem-only changes still need their equipped item tile.
  for (const slot of Object.keys(changeMarkers)) {
    const item = gearSet[slot] || equippedGear?.[slot];
    if (item && !displayItems.some((entry) => entry.slot === slot)) displayItems.push(item);
  }

  const deltaPct = baseDps > 0 ? (result.delta / baseDps) * 100 : 0;
  const deltaTone =
    result.delta > 0 ? 'text-positive' : result.delta < 0 ? 'text-negative' : 'text-fg-4';
  const deltaSubTone =
    result.delta > 0 ? 'text-positive/70' : result.delta < 0 ? 'text-negative/70' : 'text-fg-4';
  // Mock `.rank.best`: gold wash + 3px inset bar; selection and compare reuse the shape.
  const stateClass = isBest
    ? 'bg-gradient-to-r from-gold/10 to-transparent to-55% shadow-[inset_3px_0_0_theme(colors.gold.fill)]'
    : isSelected
      ? 'bg-gradient-to-r from-positive/10 to-transparent to-55% shadow-[inset_3px_0_0_theme(colors.positive)]'
      : isCompareTarget
        ? 'bg-gradient-to-r from-quality-rare/10 to-transparent to-55% shadow-[inset_3px_0_0_theme(colors.quality.rare)]'
        : 'hover:bg-overlay/[0.015]';

  return (
    <div
      onClick={() => onSelect?.(result.name)}
      className={`group relative grid cursor-pointer items-start gap-2 border-b border-line/[0.06] px-3 py-2 transition-colors [contain-intrinsic-size:auto_62px] [content-visibility:auto] last:border-b-0 sm:gap-3 sm:px-4 ${
        rank != null
          ? 'grid-cols-[30px_minmax(0,1fr)_auto] sm:grid-cols-[42px_minmax(0,1fr)_120px]'
          : 'grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_120px]'
      } ${stateClass}`}
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0 bg-overlay/[0.02]"
        style={{ width: `${barWidth}%` }}
      />
      {rank != null && (
        <span
          className={`relative font-headline text-[15px] font-extrabold tabular-nums ${
            isBest ? 'text-gold' : 'text-fg-4'
          }`}
        >
          #{rank}
        </span>
      )}

      <div className="relative min-w-0">
        <ComboSummary
          result={result}
          displayItems={displayItems}
          changedItems={changedItems}
          enchantGemItems={enchantGemItems}
          isEquipped={isEquipped}
          itemInfoMap={itemInfoMap}
          gemInfoMap={gemInfoMap}
          changeMarkers={changeMarkers}
          badge={isBest && <Pill variant="gold">{t('gear.best')}</Pill>}
        />
        {detailChanges.length > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              aria-expanded={detailsOpen}
              onClick={(event) => {
                event.stopPropagation();
                setDetailsOpen(!detailsOpen);
              }}
              className="rounded text-xs font-semibold text-gold hover:underline"
            >
              {detailsOpen ? 'Hide changes' : `Changes (${detailChanges.length})`}{' '}
              {detailsOpen ? '▴' : '▾'}
            </button>
            {detailsOpen && (
              <div className="mt-1 flex flex-wrap gap-1">
                {detailChanges.map((detail, i) => (
                  <span
                    key={i}
                    className="rounded bg-gold/10 px-1.5 py-0.5 text-xs text-ench ring-1 ring-gold/40"
                  >
                    {detail}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="relative text-right">
        <div className="flex items-center justify-end gap-1.5 font-headline text-[15px] font-extrabold tabular-nums">
          {Math.round(result.dps).toLocaleString()}
          {result.precision_pct != null && (
            <PrecisionDot pct={result.precision_pct} targetError={targetError} />
          )}
        </div>
        <div className={`mt-1 text-[11.5px] font-bold tabular-nums ${deltaTone}`}>
          {result.delta > 0
            ? `+${Math.round(result.delta).toLocaleString()}`
            : result.delta < 0
              ? Math.round(result.delta).toLocaleString()
              : '—'}
          {baseDps > 0 && result.delta !== 0 && (
            <span className={`ml-1.5 font-medium ${deltaSubTone}`}>
              {result.delta > 0 ? '+' : ''}
              {deltaPct.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="relative mt-1 flex items-center justify-end gap-1">
          {onCompare && !isEquipped && (
            <button
              type="button"
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                onCompare(result.name);
              }}
              title={t('gear.compareRowTitle')}
              aria-label={t('gear.compareRowTitle')}
              className={`${ROW_ACTION} ${isCompareTarget ? '!border-info/40 !text-info' : 'hover:text-info'}`}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 3v10M11 3v10M2 6l3-3 3 3M8 10l3 3 3-3" />
              </svg>
            </button>
          )}
          {showVerifyButton && (
            <button
              type="button"
              onClick={async (e: MouseEvent) => {
                e.stopPropagation();
                if (!sourceJobId || comboId == null || verifying) return;
                setVerifying(true);
                try {
                  const newId = await simRow(sourceJobId, comboId);
                  router.push(`/sim/${newId}`);
                } catch {
                  setVerifying(false);
                }
              }}
              disabled={verifying}
              title={t('gear.verifyRowTitle')}
              aria-label={t('gear.verifyRowTitle')}
              className={`${ROW_ACTION} hover:text-on-surface`}
            >
              {verifying ? (
                '…'
              ) : (
                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5 3l8 5-8 5z" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
