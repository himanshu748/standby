import { useEffect, useState } from 'react';
import type { IssueCover, Person } from '../../../src/core/model';
import { api, fullDrillPath, type Receipt } from './api';
import { Confirm } from './Confirm';
import { Avatar, coverageText, fmtDate } from './ui';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (days: number) => iso(new Date(Date.now() + days * 86_400_000));
const GRAPH_TOUCH = 'per Teamwork Graph';
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The Jira issue panel: the drill for the issue in view, if its assignee is out for the next two weeks. */
export function Panel() {
  const [win] = useState({ from: plus(1), to: plus(14) });
  const [data, setData] = useState<IssueCover | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [to, setTo] = useState<Person | null>(null);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [drillPath, setDrillPath] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void api
      .issue(win)
      .then((d) => {
        if (!current) return;
        setData(d);
        setTo(d.item?.backups[0]?.person ?? null);
      })
      .catch((e) => {
        if (current) setLoadError(errText(e));
      });
    return () => { current = false; };
  }, [win, attempt]);

  useEffect(() => {
    void fullDrillPath().then(setDrillPath).catch(() => undefined);
  }, [attempt]);

  const reassign = async () => {
    if (!data?.item?.key || !to) return;
    setActionError(null);
    setReceipt(null);
    setBusy(true);
    try {
      const [r] = await api.reassign([{ key: data.item.key, to }]);
      setReceipt(r ?? null);
    } catch (e) {
      setActionError(errText(e));
    } finally {
      setBusy(false);
      setAsk(false);
    }
  };

  if (loadError)
    return (
      <div className="ipanel">
        <p className="error" role="alert">
          {loadError}
        </p>
        <button type="button" className="btn ghost" onClick={() => {
          setLoadError(null);
          setAttempt((n) => n + 1);
        }}>Retry issue check</button>
      </div>
    );
  if (!data)
    return (
      <div className="ipanel" aria-busy="true">
        <p className="panel-wait">
          <span className="brand-dot" aria-hidden="true" /> Checking who else knows this issue…
        </p>
      </div>
    );
  const { person, item } = data;
  if (data.done)
    return (
      <div className="ipanel">
        <p className="panel-wait">Done: nothing left to stall if {person?.name ?? 'the assignee'} is out.</p>
      </div>
    );
  if (!person || !item)
    return (
      <div className="ipanel">
        <p className="panel-wait">Unassigned: there is nobody whose absence would stall it.</p>
      </div>
    );

  const others = item.touchedBy;
  const pick = item.backups.find((b) => b.person.accountId === to?.accountId);
  return (
    <div className="ipanel">
      <p className="panel-kicker">
        <Avatar person={person} size={22} />
        <span>
          If <strong>{person.name}</strong> is out {fmtDate(win.from)} – {fmtDate(win.to)}
        </span>
      </p>
      <div className={`panel-verdict card-${item.coverage}`}>
        <span className={`verdict-word verdict-${item.coverage}`}>{coverageText[item.coverage].label}</span>
        <span className="verdict-sub">
          {coverageText[item.coverage].long}
          <span className="verdict-n">
            {others.length} on record · {item.backups.length} {item.backups.length === 1 ? 'backup' : 'backups'}
          </span>
        </span>
      </div>
      {item.urgencyNotes.length > 0 && (
        <div className="chips">
          {item.urgencyNotes.map((n) => (
            <span key={n} className="chip chip-hot">
              {n}
            </span>
          ))}
        </div>
      )}

      <h3 className="panel-h">Who else is on record</h3>
      {others.length ? (
        <ul className="panel-people">
          {others.map((t) => (
            <li key={t.accountId}>
              <Avatar person={t} size={22} />
              <strong>{t.name}</strong>
              <span className={t.how.includes(GRAPH_TOUCH) ? 'chip chip-graph' : 'panel-how'}>{t.how}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel-how">Nobody else has touched it in Jira or Teamwork Graph.</p>
      )}

      <h3 className="panel-h">Who can pick it up</h3>
      {item.backups.length ? (
        <fieldset className="panel-backups">
          <legend className="sr">Backup for {item.key}</legend>
          {item.backups.map((b) => (
            <label key={b.person.accountId} className={to?.accountId === b.person.accountId ? 'on' : ''}>
              <input type="radio" name="backup" checked={to?.accountId === b.person.accountId} onChange={() => {
                  setTo(b.person);
                  setReceipt((r) => (r?.ok ? r : null));
                }} />
              <Avatar person={b.person} size={22} />
              <span>
                <strong>{b.person.name}</strong>
                <span className="panel-how">{b.reasons.map((r) => r.text).join(' · ')}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="panel-how">No backup found: nobody else in {item.container?.name ?? 'this project'} or their teams is on record.</p>
      )}

      <div className="panel-actions">
        {pick && !receipt?.ok && (
          <button type="button" className="btn hot" onClick={() => setAsk(true)}>
            Reassign to {pick.person.name}
          </button>
        )}
        {drillPath && (
          <button type="button" className="btn ghost" onClick={() => void api.go(drillPath)}>
            Full drill for {person.name.split(' ')[0]}
          </button>
        )}
      </div>
      {receipt && (
        <p className={receipt.ok ? 'panel-done' : 'error'} role="status">
          {receipt.ok ? `Reassigned ${receipt.key} to ${receipt.to.name}. Refresh the issue to see it.` : receipt.error}
        </p>
      )}
      {actionError && <p className="error" role="alert">{actionError}</p>}

      <ul className="panel-sources" aria-label="Where this came from">
        {data.sources.map((s) => (
          <li key={s.source} className={s.ok ? 'ok' : 'warn'}>
            <strong>{s.label}</strong> {s.note}
          </li>
        ))}
      </ul>

      {ask && pick && (
        <Confirm title={`Reassign ${item.key}?`} action="Reassign" busy={busy} onCancel={() => setAsk(false)} onConfirm={() => void reassign()}>
          <p>
            {item.key} moves from {person.name} to {pick.person.name} in Jira. You can change it back from the issue.
          </p>
        </Confirm>
      )}
    </div>
  );
}
