'use client';
/* eslint-disable @next/next/no-img-element */

import {
  QUALITY_COLORS,
  getWowheadData,
  getWowheadUrl,
  localizedEnchantName,
  localizedGemName,
  localizedItemName,
  toGemIdList,
  useItemNames,
  iconProps,
} from '../../lib/useItemInfo';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { SLOT_LABELS } from '../../lib/types';
import type { GearItem } from './gearOverviewTypes';
import Pill from '../ui/Pill';

/** Mock `.gr`: 7px-radius row with a hover fill. */
const ROW =
  'flex items-center gap-2 rounded-[7px] px-2 py-1 transition-colors duration-[120ms] hover:bg-surface-container-high';

interface GearSlotRowProps {
  slot: string;
  item?: GearItem;
  baselineItem?: GearItem;
  isUpgrade?: boolean;
  isDowngrade?: boolean;
  /** Compare mode: both sets carry the same change vs equipped in this slot. */
  isShared?: boolean;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  align?: 'left' | 'right';
}

export default function GearSlotRow({
  slot,
  item,
  baselineItem,
  isUpgrade,
  isDowngrade,
  isShared,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  align = 'left',
}: GearSlotRowProps) {
  const { t, locale } = useLanguage();
  useItemNames();
  const rtl = align === 'right';

  if (!item || item.item_id <= 0) {
    return (
      <div className={`${ROW} ${rtl ? 'flex-row-reverse' : ''}`}>
        <div className="h-[38px] w-[38px] shrink-0 rounded-[5px] border border-dashed border-line/[0.11] bg-surface-container-high" />
        <div className={rtl ? 'text-right' : ''}>
          <p className="text-sm text-outline">{SLOT_LABELS[slot] || slot}</p>
          <p className="mt-px text-xs text-outline">{t('gear.empty')}</p>
        </div>
      </div>
    );
  }

  const info = itemInfoMap[item.item_id];
  const enchant = item.enchant_id ? enchantInfoMap[item.enchant_id] : undefined;
  const gemIdList = toGemIdList(item);
  const enchantChanged =
    !!baselineItem && (item.enchant_id || 0) !== (baselineItem.enchant_id || 0);
  const gemsChanged = !!baselineItem && gemIdList.join(',') !== toGemIdList(baselineItem).join(',');
  const qualityColor = info ? QUALITY_COLORS[info.quality] || QUALITY_COLORS[1] : QUALITY_COLORS[1];
  const name = localizedItemName(
    item.item_id,
    info?.name || item.name || `Item ${item.item_id}`,
    locale
  );
  const icon = info?.icon || 'inv_misc_questionmark';
  const wowheadData = item.item_id > 0 ? getWowheadData(item) : undefined;
  const fadeDir = rtl ? 'to left' : 'to right';

  return (
    <div className={`relative ${ROW} ${rtl ? 'flex-row-reverse' : ''}`}>
      {isUpgrade && (
        <div className="pointer-events-none absolute inset-0 rounded-[7px] border border-gold/60 bg-gold/10" />
      )}
      {isDowngrade && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[7px] bg-negative/[0.15] ring-1 ring-negative/30"
          style={{
            maskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
            WebkitMaskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
          }}
        />
      )}
      {isShared && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[7px] bg-info/[0.15] ring-1 ring-info/30"
          style={{
            maskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
            WebkitMaskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
          }}
        />
      )}
      <a
        href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
        data-wowhead={wowheadData}
        className="relative block h-[38px] w-[38px] shrink-0 overflow-hidden rounded-[5px] border"
        style={{ borderColor: qualityColor }}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.preventDefault()}
      >
        <img
          {...iconProps(icon)}
          alt=""
          width={38}
          height={38}
          className="h-full w-full"
          loading="lazy"
        />
        <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.7)]" />
        {isUpgrade && (
          <span
            className="absolute bottom-0 right-0 grid h-[18px] w-[18px] place-items-center rounded-tl bg-black/80"
            role="img"
            aria-label={t('gear.upgrade')}
            title={
              item.upgrade_levels
                ? `${t('gear.upgrade')} +${item.upgrade_levels}`
                : t('gear.upgrade')
            }
          >
            <svg viewBox="0 0 18 18" className="h-[16px] w-[16px]" aria-hidden="true">
              <path
                d="M9 1 16 8h-3.5v8h-7V8H2z"
                fill="#39e75f"
                stroke="#052b0b"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
              <path d="M9 3.1 13 7H11v7.5H7V7H5z" fill="#8bff91" opacity=".55" />
            </svg>
          </span>
        )}
      </a>
      <div className={`min-w-0 flex-1 ${rtl ? 'text-right' : ''}`}>
        <div className={`flex flex-wrap items-center gap-1.5 ${rtl ? 'flex-row-reverse' : ''}`}>
          <a
            href={item.item_id > 0 ? getWowheadUrl(item.item_id, locale) : undefined}
            data-wowhead={wowheadData}
            className="text-sm font-semibold leading-tight no-underline [overflow-wrap:anywhere]"
            style={{ color: qualityColor }}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.preventDefault()}
          >
            {name}
          </a>
          {isUpgrade && !!item.upgrade_levels && (
            <span className="shrink-0 text-xs font-bold text-positive">+{item.upgrade_levels}</span>
          )}
          {isDowngrade && (
            <Pill variant="negative" size="sm" className="shrink-0">
              {t('gear.downgrade')}
            </Pill>
          )}
          {item.origin === 'vault' && (
            <Pill variant="warning" size="sm" className="shrink-0">
              Vault
            </Pill>
          )}
          {item.origin === 'loot' && (
            <Pill variant="info" size="sm" className="shrink-0">
              Loot
            </Pill>
          )}
        </div>
        <p className="mt-px text-xs text-outline">
          {SLOT_LABELS[slot] || slot}
          {item.ilevel > 0 && ` · ${item.ilevel}`}
          {info?.tag && ` · ${info.tag}`}
        </p>
        {(gemIdList.length > 0 ||
          gemsChanged ||
          item.enchant_id ||
          enchantChanged ||
          (info?.sockets ?? 0) > 0) && (
          <div
            className={`mt-0.5 flex flex-wrap items-center gap-1 text-xs leading-tight ${rtl ? 'justify-end' : ''}`}
          >
            {gemIdList.length ? (
              gemIdList.map((id, i) => {
                const gem = gemInfoMap[id];
                return (
                  <span
                    key={`${id}-${i}`}
                    title={gemsChanged ? 'Gem changed from equipped gear' : 'Gem'}
                    className={`inline-flex items-center gap-1 rounded px-1 py-px text-gem ${gemsChanged ? 'bg-gold/10 ring-1 ring-gold/50' : ''}`}
                  >
                    {gem && (
                      <img {...iconProps(gem.icon)} alt="" className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {gem ? localizedGemName(gem, locale) : `Gem #${id}`}
                    {gemsChanged && <span className="sr-only"> · changed</span>}
                  </span>
                );
              })
            ) : gemsChanged ? (
              <span className="rounded bg-gold/10 px-1 text-gem ring-1 ring-gold/50">
                Gem removed
              </span>
            ) : (info?.sockets ?? 0) > 0 ? (
              <span className="text-gem">
                {(info?.sockets ?? 0) > 1 ? t('gear.sockets') : t('gear.socket')}
              </span>
            ) : null}
            {(item.enchant_id || enchantChanged) && (
              <span
                title={enchantChanged ? 'Enchant changed from equipped gear' : 'Enchant'}
                className={`rounded px-1 py-px text-ench ${enchantChanged ? 'bg-gold/10 ring-1 ring-gold/50' : ''}`}
              >
                <span aria-hidden="true">✦ </span>
                {item.enchant_id
                  ? enchant
                    ? localizedEnchantName(enchant, locale)
                    : `Enchant #${item.enchant_id}`
                  : 'Enchant removed'}
                {enchantChanged && <span className="sr-only"> · changed</span>}
              </span>
            )}
          </div>
        )}
        {item.embellishment && (
          <p className="text-xs text-quality-epic/80">{item.embellishment.name}</p>
        )}
      </div>
    </div>
  );
}
