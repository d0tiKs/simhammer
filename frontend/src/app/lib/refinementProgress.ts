/** The backend reports the running row as "61 / 77: Combo 1086". */
export function refinementProgress(stage?: string, detail?: string) {
  if (stage !== 'Refining') return null;
  const match = detail?.match(/^\s*(\d+)\s*\/\s*(\d+):\s*(.*)$/);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (
    !Number.isSafeInteger(current) ||
    !Number.isSafeInteger(total) ||
    current < 1 ||
    total < current
  )
    return null;
  const completed = current - 1;
  return {
    current,
    total,
    completed,
    percent: Math.floor((completed / total) * 100),
    name: match[3],
  };
}
