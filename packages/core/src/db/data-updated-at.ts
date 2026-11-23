export function nextDataUpdatedAt(previous: string | null, now: number = Date.now()): string {
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  const updatedAt = Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now;
  return new Date(updatedAt).toISOString();
}
