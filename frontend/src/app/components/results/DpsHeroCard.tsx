/* eslint-disable @next/next/no-img-element */

import { getCharacterRenderUrl } from '../gear/topGearResultsUtils';
import { useTrimmedRender } from '../gear/useTrimmedRender';
import { API_URL } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { useRealmSlug } from '../../lib/realms';
import Pill from '../ui/Pill';
import HeroMetaStat from './HeroMetaStat';
import { FIGHT_STYLES } from '../sim-config/FightStyleSelector';
import {
  FACTION_BGS,
  FACTION_ICONS,
  formatDuration,
  formatElapsed,
  useFaction,
} from './dpsHeroUtils';

// Mock `.hero .bg`: base gradient plus a gold glow top-left and a faction tint top-right.
const HERO_BASE =
  'linear-gradient(180deg,rgb(var(--c-surface-container-high)),rgb(var(--c-surface-container)))';
const FACTION_TINT: Record<string, string> = {
  horde: 'rgb(140 32 24 / var(--hero-tint-a))',
  alliance: 'rgb(24 56 140 / var(--hero-tint-a))',
};

function heroGlow(faction: string | null): string {
  const gold =
    'radial-gradient(ellipse 40% 60% at 15% 0%,rgb(var(--c-primary-fill) / .07),transparent 70%)';
  const tint = faction ? FACTION_TINT[faction] : undefined;
  return tint
    ? `radial-gradient(ellipse 55% 90% at 82% 30%,${tint},transparent 70%),${gold}`
    : gold;
}

interface DpsHeroCardProps {
  playerName: string;
  playerClass: string;
  playerRealm?: string;
  playerRegion?: string;
  dps: number;
  fightLength?: number;
  fightStyle?: string | null;
  desiredTargets?: number;
  iterations?: number;
  targetError?: number;
  elapsedTime?: number;
  baseDps?: number;
  children?: React.ReactNode;
  topAction?: React.ReactNode;
  /** Sits in the empty space right of the DPS number (below it on narrow screens). */
  aside?: React.ReactNode;
}

export default function DpsHeroCard({
  playerName,
  playerClass,
  playerRealm,
  playerRegion,
  dps,
  fightLength,
  fightStyle,
  iterations,
  targetError,
  desiredTargets,
  elapsedTime,
  baseDps,
  children,
  topAction,
  aside,
}: DpsHeroCardProps) {
  const { t } = useLanguage();
  const dpsDelta = baseDps != null && baseDps > 0 ? dps - baseDps : null;
  const dpsDeltaPct = baseDps != null && baseDps > 0 ? ((dps - baseDps) / baseDps) * 100 : null;

  const style = FIGHT_STYLES.find((entry) => entry.value === fightStyle);
  const fightStyleLabel = style
    ? t(style.labelKey)
    : fightStyle?.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');

  const hasMetadata =
    !!fightStyleLabel ||
    (targetError != null && targetError > 0) ||
    fightLength != null ||
    (iterations != null && iterations > 0) ||
    elapsedTime != null ||
    (desiredTargets != null && desiredTargets > 0);

  const realmSlug = useRealmSlug(playerRealm);
  const faction = useFaction(realmSlug, playerName, playerRegion);
  const characterRenderUrl = getCharacterRenderUrl(realmSlug, playerName, playerRegion);
  const characterRender = useTrimmedRender(characterRenderUrl);
  const showCharacter = characterRender.status === 'trimmed' || characterRender.status === 'full';

  return (
    <section
      className="relative overflow-hidden rounded-[10px] border border-line/[0.06] [box-shadow:var(--shadow-card)] [container-type:inline-size]"
      style={{ background: HERO_BASE }}
    >
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-r from-surface-container via-surface-container/80 to-transparent" />
        </div>

        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: heroGlow(faction) }}
        />
        {faction && FACTION_BGS[faction] && (
          <img
            src={`${API_URL}${FACTION_BGS[faction]}`}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.06]"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        {faction && FACTION_ICONS[faction] && (
          <img
            src={`${API_URL}${FACTION_ICONS[faction]}`}
            alt=""
            className="pointer-events-none absolute bottom-0 right-[5%] top-[0%] h-[100%] w-auto object-contain opacity-[0.08]"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        {showCharacter && characterRenderUrl && (
          <div
            className="pointer-events-none absolute -bottom-16 -right-3 top-3 z-[1] w-[54%]"
            aria-label={`${playerName}'s current Armory appearance`}
          >
            <img
              src={characterRender.status === 'trimmed' ? characterRender.src : characterRenderUrl}
              alt={`${playerName}'s current Armory appearance`}
              className="h-full w-full object-contain object-bottom [filter:drop-shadow(0_8px_16px_rgba(0,0,0,0.4))]"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          </div>
        )}

        <div className="relative z-10 px-6 pb-[30px] pt-[34px] sm:px-9">
          <div className="relative z-10">
            <h1 className="font-headline text-[clamp(1.25rem,5.5cqw,2.125rem)] font-extrabold uppercase leading-none tracking-[-0.01em] text-on-surface">
              {playerName}
              {playerRealm ? `-${playerRealm}` : ''}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="font-headline text-[13px] font-bold uppercase tracking-[0.16em] text-on-surface-variant">
                {playerClass}
              </p>
              {topAction && <div className="relative z-20">{topAction}</div>}
            </div>
            <div className="mt-[26px] flex items-baseline gap-2.5">
              <span className="font-headline text-[clamp(3rem,15cqw,5.75rem)] font-extrabold tabular-nums leading-[0.9] tracking-[-0.03em] text-gold [text-shadow:0_0_60px_rgb(var(--c-primary)/var(--hero-glow-a))]">
                {Math.round(dps).toLocaleString()}
              </span>
              <span className="font-headline text-xl font-extrabold tracking-[0.04em] text-gold-dark">
                {t('results.dps')}
              </span>
            </div>
            {dpsDelta != null && dpsDeltaPct != null && (
              <div className="mt-3.5">
                <Pill variant={dpsDelta >= 0 ? 'positive' : 'negative'}>
                  {dpsDelta >= 0 ? '▲' : '▼'} {Math.abs(dpsDeltaPct).toFixed(1)}%{' '}
                  {t('results.vsPreviousSim')}
                </Pill>
              </div>
            )}
            {children}
            {aside && (
              <div
                className={
                  showCharacter
                    ? 'mt-6 w-fit max-w-[66%]'
                    : 'mt-6 lg:absolute lg:bottom-[30px] lg:right-0 lg:mt-0'
                }
              >
                {aside}
              </div>
            )}
          </div>
        </div>
      </div>

      {hasMetadata && (
        <div className="relative z-10 border-t border-line/[0.06] bg-[color:var(--hero-meta-bg)] px-6 py-5 [container-type:inline-size]">
          <div className="grid grid-cols-3 gap-x-4 gap-y-5 [@container(min-width:52rem)]:grid-cols-6">
            {fightStyleLabel && (
              <HeroMetaStat label={t('config.fightStyle')} value={fightStyleLabel} />
            )}
            {fightLength != null && (
              <HeroMetaStat label={t('results.fightLength')} value={formatDuration(fightLength)} />
            )}
            {desiredTargets != null && desiredTargets > 0 && (
              <HeroMetaStat label={t('results.targets')} value={`${desiredTargets}`} />
            )}
            {targetError != null && targetError > 0 && (
              <HeroMetaStat
                label={t('results.error')}
                value={`± ${targetError}%`}
                note={`± ${Math.round((targetError / 100) * dps).toLocaleString()} ${t('results.dps')}`}
              />
            )}
            {iterations != null && iterations > 0 && (
              <HeroMetaStat label={t('results.iterations')} value={iterations.toLocaleString()} />
            )}
            {elapsedTime != null && (
              <HeroMetaStat label={t('results.elapsed')} value={formatElapsed(elapsedTime)} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
