import { useEffect, useState } from 'react';

export function useDatabaseRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((value) => value + 1);
    window.addEventListener('finance-db-change', onChange);
    return () => window.removeEventListener('finance-db-change', onChange);
  }, []);
  return revision;
}

export function moveItem<T extends { id: number }>(items: T[], id: number, offset: -1 | 1): T[] {
  const from = items.findIndex((item) => item.id === id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function inr(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}
