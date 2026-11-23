import type { AssessedItem, Coverage } from './model';

export type Placed = { id: string; x: number; y: number; r: number; coverage: Coverage };

/** Ring radius (fraction of the half-size) by coverage: what stalls sits furthest out, where it is easiest to see. */
export const ringOf: Record<Coverage, number> = { covered: 0.42, thin: 0.66, stalls: 0.9 };

/**
 * Deterministic orbit layout: items keep the order given, spread evenly per ring, with each ring
 * rotated a little so nodes on neighbouring rings do not line up.
 */
export function orbit(items: AssessedItem[], size: number): Placed[] {
  const half = size / 2;
  const out: Placed[] = [];
  (['covered', 'thin', 'stalls'] as const).forEach((coverage, ringIndex) => {
    const ring = items.filter((i) => i.coverage === coverage);
    const radius = ringOf[coverage] * (half - 18);
    const room = ring.length ? (Math.PI * radius) / ring.length - 1.5 : 14;
    ring.forEach((item, i) => {
      const angle = -Math.PI / 2 + ringIndex * 0.35 + (2 * Math.PI * i) / ring.length;
      out.push({
        id: item.id,
        x: half + radius * Math.cos(angle),
        y: half + radius * Math.sin(angle),
        r: Math.max(2.5, Math.min(room, 14, 6 + item.urgency * 1.4)),
        coverage,
      });
    });
  });
  return out;
}
