import type { AssessedItem, Person } from '../../../src/core/model';
import { orbit, ringOf } from '../../../src/core/layout';
import { initials } from './ui';

const SIZE = 520;

export function Orbit({ person, items, focus, onFocus }: { person: Person; items: AssessedItem[]; focus: string | null; onFocus: (id: string | null) => void }) {
  const placed = orbit(items, SIZE);
  const byId = new Map(items.map((i) => [i.id, i]));
  const half = SIZE / 2;
  return (
    <svg className="orbit" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${items.length} pieces of work around ${person.name}; outer ring stalls without them`}>
      <defs>
        <radialGradient id="core" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#FFD08A" />
          <stop offset="100%" stopColor="#FF7A45" />
        </radialGradient>
      </defs>
      {(['covered', 'thin', 'stalls'] as const).map((c, i) => (
        <circle key={c} className={`ring ring-${c}`} cx={half} cy={half} r={ringOf[c] * (half - 18)} style={{ animationDelay: `${i * 120}ms` }} />
      ))}
      <g className="sweep">
        <line x1={half} y1={half} x2={half} y2={18} />
      </g>
      {placed.map((p, i) => (
        <line key={`l${p.id}`} className={`spoke spoke-${p.coverage} ${focus === p.id ? 'on' : ''}`} x1={half} y1={half} x2={p.x} y2={p.y} style={{ animationDelay: `${300 + i * 18}ms` }} />
      ))}
      {placed.map((p, i) => {
        const item = byId.get(p.id)!;
        return (
          <g
            key={p.id}
            className={`node node-${p.coverage} ${focus === p.id ? 'on' : ''}`}
            style={{ ['--x' as string]: `${p.x}px`, ['--y' as string]: `${p.y}px`, animationDelay: `${300 + i * 18}ms` }}
            onMouseEnter={() => onFocus(p.id)}
            onMouseLeave={() => onFocus(null)}
          >
            <circle cx={p.x} cy={p.y} r={p.r + 8} className="halo" />
            <circle cx={p.x} cy={p.y} r={p.r} className="dot" />
            <title>{`${item.key ? `${item.key} ` : ''}${item.title}`}</title>
          </g>
        );
      })}
      <circle cx={half} cy={half} r={44} fill="url(#core)" className="core" />
      <text x={half} y={half + 9} textAnchor="middle" className="core-text">
        {initials(person.name)}
      </text>
    </svg>
  );
}
