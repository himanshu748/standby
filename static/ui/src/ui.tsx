import { useEffect, useState } from 'react';
import type { Coverage, Person } from '../../../src/core/model';

export const coverageText: Record<Coverage, { label: string; long: string }> = {
  stalls: { label: 'Stalls', long: 'Nobody else has touched it' },
  thin: { label: 'Thin', long: 'One other person on record' },
  covered: { label: 'Covered', long: 'Two or more others on record' },
};

function hue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function Avatar({ person, size = 32 }: { person: Person; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, ['--h' as string]: hue(person.accountId) }} aria-hidden="true">
      {initials(person.name)}
    </span>
  );
}

/** Counts up to the value once, unless the user prefers reduced motion. */
export function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setN(value);
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 900);
      setN(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n}</>;
}

export const fmtDate = (iso?: string) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
