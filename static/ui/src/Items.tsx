import type { AssessedItem, Person } from '../../../src/core/model';
import { api } from './api';
import { Avatar, coverageText, fmtDate } from './ui';

const sourceLabel = { jira: 'Jira', confluence: 'Confluence', graph: 'Teamwork Graph' } as const;

export type Pick = Record<string, { to: Person; on: boolean }>;

export function ItemCard({
  item,
  index,
  focused,
  pick,
  onFocus,
  onPick,
}: {
  item: AssessedItem;
  index: number;
  focused: boolean;
  pick: Pick[string] | undefined;
  onFocus: (id: string | null) => void;
  onPick: (id: string, v: Pick[string]) => void;
}) {
  const chosen = pick?.to ?? item.backups[0]?.person;
  const candidate = item.backups.find((b) => b.person.accountId === chosen?.accountId);
  const canReassign = item.kind === 'issue' && item.roles.includes('assignee') && !!chosen;
  return (
    <li
      className={`card card-${item.coverage} ${focused ? 'on' : ''}`}
      style={{ animationDelay: `${Math.min(index, 14) * 40}ms` }}
      onMouseEnter={() => onFocus(item.id)}
      onMouseLeave={() => onFocus(null)}
      onFocus={() => onFocus(item.id)}
    >
      <div className="card-top">
        <span className={`pill pill-${item.coverage}`} title={coverageText[item.coverage].long}>
          {coverageText[item.coverage].label}
        </span>
        <span className="card-meta">
          {[item.key, item.container?.name, item.status, item.dueAt && `due ${fmtDate(item.dueAt)}`].filter(Boolean).join(' · ')}
        </span>
      </div>
      <button type="button" className="card-title" onClick={() => api.open(item.url)}>
        {item.title}
        <span aria-hidden="true"> ↗</span>
      </button>
      <div className="chips">
        {item.roles.map((r) => (
          <span key={r} className="chip">
            {r}
          </span>
        ))}
        {item.sources.map((s) => (
          <span key={s} className={`chip chip-src chip-${s}`}>
            {sourceLabel[s]}
          </span>
        ))}
        {item.urgencyNotes.map((n) => (
          <span key={n} className="chip chip-hot">
            {n}
          </span>
        ))}
      </div>
      {item.backups.length > 0 ? (
        <div className="backup">
          <Avatar person={chosen!} size={26} />
          <label className="backup-pick">
            <span className="sr">Backup for {item.title}</span>
            <select
              value={chosen!.accountId}
              onChange={(e) => {
                const b = item.backups.find((x) => x.person.accountId === e.target.value)!;
                onPick(item.id, { to: b.person, on: pick?.on ?? false });
              }}
            >
              {item.backups.map((b) => (
                <option key={b.person.accountId} value={b.person.accountId}>
                  {b.person.name}
                </option>
              ))}
            </select>
          </label>
          <span className="backup-why">{candidate?.reasons.map((r) => r.text).join(' · ')}</span>
          {canReassign && (
            <label className="toggle">
              <input type="checkbox" checked={pick?.on ?? false} onChange={(e) => onPick(item.id, { to: chosen!, on: e.target.checked })} />
              <span>Reassign</span>
            </label>
          )}
        </div>
      ) : (
        <p className="backup backup-none">No one else on record yet. Pick a backup in the handover.</p>
      )}
    </li>
  );
}
