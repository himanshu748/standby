import { useId } from 'react';
import type { AssessedItem, Person } from '../../../src/core/model';
import { orbit, ringLabelAnchor, ringLabelAngle, ringOf } from '../../../src/core/layout';
import { coverageText, initials } from './ui';

const SIZE = 520;
const PAD = 64;

function labelPose(count: number, ringIndex: number, radius: number, half: number) {
  const angle = ringLabelAngle(count, ringIndex);
  const cos = Math.cos(angle);
  return { x: half + cos * (radius + 18), y: half + Math.sin(angle) * (radius + 18), anchor: ringLabelAnchor(angle) };
}

function shortLabel(item: AssessedItem): string {
  const name = item.key ? `${item.key} ${item.title}` : item.title;
  return name.length > 46 ? `${name.slice(0, 45)}…` : name;
}

export function Orbit({ person, items, focus, onFocus }: { person: Person; items: AssessedItem[]; focus: string | null; onFocus: (id: string | null) => void }) {
  const placed = orbit(items, SIZE);
  const byId = new Map(items.map((i) => [i.id, i]));
  const half = SIZE / 2;
  const gradientId = `core-${useId().replace(/:/g, '')}`;
  const focused = focus ? placed.find((p) => p.id === focus) : undefined;
  const focusedItem = focus ? byId.get(focus) : undefined;
  return (
    <svg
      className="orbit"
      viewBox={`${-PAD} ${-PAD} ${SIZE + PAD * 2} ${SIZE + PAD * 2}`}
      role="img"
      aria-label={`${items.length} pieces of work around ${person.name}. The outer ring stalls without them.`}
      style={{ ['--half' as string]: `${half}px` }}
    >
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#FFD08A" />
          <stop offset="100%" stopColor="#FF7A45" />
        </radialGradient>
      </defs>
      {(['covered', 'thin', 'stalls'] as const).map((c, i) => {
        const radius = ringOf[c] * (half - 18);
        const count = items.filter((item) => item.coverage === c).length;
        const pose = labelPose(count, i, radius, half);
        return (
          <g key={c}>
            <circle className={`ring ring-${c}`} cx={half} cy={half} r={radius} style={{ animationDelay: `${i * 120}ms` }} />
            <text className={`ring-label ring-label-${c}`} x={pose.x} y={pose.y} textAnchor={pose.anchor} dominantBaseline="middle">
              {coverageText[c].label} {count}
            </text>
          </g>
        );
      })}
      <g className="sweep" aria-hidden="true">
        <line x1={half} y1={half} x2={half} y2={28} />
      </g>
      {placed.map((p, i) => (
        <line key={`l${p.id}`} className={`spoke spoke-${p.coverage} ${focus === p.id ? 'on' : ''}`} x1={half} y1={half} x2={p.x} y2={p.y} style={{ animationDelay: `${300 + i * 18}ms` }} />
      ))}
      {placed.map((p, i) => {
        const item = byId.get(p.id)!;
        const label = `${item.key ? `${item.key} ` : ''}${item.title}. ${coverageText[item.coverage].long}.`;
        const showKey = item.coverage === 'stalls' && item.key && focus !== p.id && items.filter((x) => x.coverage === 'stalls').length <= 10;
        const dx = p.x - half;
        const dy = p.y - half;
        const len = Math.hypot(dx, dy) || 1;
        return (
          <g
            key={p.id}
            className={`node node-${p.coverage} ${focus === p.id ? 'on' : ''}`}
            style={{ ['--x' as string]: `${p.x}px`, ['--y' as string]: `${p.y}px`, animationDelay: `${300 + i * 18}ms` }}
            tabIndex={0}
            role="button"
            aria-pressed={focus === p.id}
            aria-label={label}
            onMouseEnter={() => onFocus(p.id)}
            onMouseLeave={(e) => {
              if (e.currentTarget !== document.activeElement) onFocus(null);
            }}
            onFocus={() => onFocus(p.id)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              onFocus(null);
              const node = e.currentTarget;
              if ('blur' in node && typeof node.blur === 'function') node.blur();
            }}
          >
            <circle cx={p.x} cy={p.y} r={p.r + 8} className="halo" />
            <circle cx={p.x} cy={p.y} r={focus === p.id ? p.r + 2 : p.r} className="dot" />
            {showKey && (
              <text className="node-key" x={p.x + (dx / len) * (p.r + 14)} y={p.y + (dy / len) * (p.r + 14)} textAnchor="middle" dominantBaseline="middle">
                {item.key}
              </text>
            )}
            <title>{label}</title>
          </g>
        );
      })}
      {focused && focusedItem && (
        <g className={`callout callout-${focusedItem.coverage}`} aria-hidden="true">
          <Callout x={focused.x} y={focused.y + focused.r} text={shortLabel(focusedItem)} />
        </g>
      )}
      <circle cx={half} cy={half} r={44} fill={`url(#${gradientId})`} className="core">
        <title>{person.name}</title>
      </circle>
      <text x={half} y={half + 9} textAnchor="middle" className="core-text">
        {initials(person.name)}
      </text>
    </svg>
  );
}

function Callout({ x, y, text }: { x: number; y: number; text: string }) {
  const width = Math.min(300, Math.max(108, text.length * 7.2));
  const left = Math.max(12, Math.min(SIZE - width - 12, x - width / 2));
  const top = y + 30 > SIZE - 8 ? y - 40 : y + 10;
  return (
    <>
      <rect className="callout-bg" x={left} y={top} width={width} height={26} rx={8} />
      <text className="callout-text" x={left + width / 2} y={top + 17} textAnchor="middle">
        {text}
      </text>
    </>
  );
}
