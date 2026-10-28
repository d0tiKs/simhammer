interface HeroMetaStatProps {
  label: string;
  value: string;
  note?: string;
}

export default function HeroMetaStat({ label, value, note }: HeroMetaStatProps) {
  return (
    <div className="min-w-[90px] flex-1">
      <span className="lbl text-[10px]">{label}</span>
      <span className="mt-1 block font-headline text-sm font-extrabold text-on-surface">
        {value}
        {note && (
          <span className="mt-0.5 block font-sans text-[11px] font-semibold text-fg-4">{note}</span>
        )}
      </span>
    </div>
  );
}
