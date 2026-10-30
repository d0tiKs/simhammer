'use client';

import packageJson from '../../../package.json';
import releases from '../../data/changelog.json';
import PageHeader from '../components/ui/PageHeader';
import { useLanguage } from '../lib/i18n';

export default function ChangelogPage() {
  const { t } = useLanguage();
  const commit = process.env.NEXT_PUBLIC_BUILD_COMMIT;

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-20">
      <PageHeader
        eyebrow="SimHammer"
        title={t('nav.changelog')}
        subtitle={t('changelog.description')}
      />
      <section className="rounded-[10px] border border-line/[0.06] bg-surface-container p-6">
        <h2 className="font-headline text-lg font-bold text-on-surface">
          {t('changelog.installedVersion')}
        </h2>
        <dl className="mt-4 flex flex-wrap gap-x-12 gap-y-4 text-sm">
          <div>
            <dt className="text-on-surface-variant">{t('changelog.version')}</dt>
            <dd className="mt-1 font-mono text-gold">v{packageJson.version}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-on-surface-variant">{t('changelog.commit')}</dt>
            <dd className="mt-1 break-all font-mono text-on-surface">
              {commit ? (
                <a
                  href={`https://github.com/d0tiKs/simhammer/commit/${commit}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-gold/40 underline-offset-4 hover:text-gold"
                >
                  {commit}
                </a>
              ) : (
                t('changelog.commitUnavailable')
              )}
            </dd>
          </div>
        </dl>
      </section>
      {releases.map((release) => (
        <section
          key={release.version}
          className="rounded-[10px] border border-line/[0.06] bg-surface-container p-6"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-headline text-xl font-bold text-gold">v{release.version}</h2>
            <time dateTime={release.date} className="text-sm text-on-surface-variant">
              {release.date}
            </time>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-on-surface-variant">
            {release.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
