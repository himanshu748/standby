import { useEffect, useMemo, useState } from 'react';
import type { Coverage, Drill, Person } from '../../../src/core/model';
import { api, type Receipt, type Space, type Window } from './api';
import { Confirm } from './Confirm';
import { ItemCard, type Pick } from './Items';
import { Orbit } from './Orbit';
import { PersonPicker } from './PersonPicker';
import { Avatar, CountUp, coverageText, fmtDate } from './ui';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (days: number) => iso(new Date(Date.now() + days * 86_400_000));
const STEPS = ['Reading their Jira work', 'Reading their Confluence pages', 'Walking Teamwork Graph', 'Finding who else has touched it'];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const [person, setPerson] = useState<Person | null>(null);
  const [win, setWin] = useState<Window>({ from: plus(1), to: plus(12) });
  const [drill, setDrill] = useState<Drill | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [filter, setFilter] = useState<Coverage | 'all'>('all');
  const [picks, setPicks] = useState<Pick>({});
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceId, setSpaceId] = useState('');
  const [ask, setAsk] = useState<'reassign' | 'handover' | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [page, setPage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1100);
    return () => clearInterval(t);
  }, [loading]);

  const run = async () => {
    if (!person) return;
    setLoading(true);
    setStep(0);
    setError(null);
    setReceipts([]);
    setPage(null);
    setPicks({});
    try {
      const [d, s] = await Promise.all([api.drill(person.accountId, win), spaces.length ? Promise.resolve(spaces) : api.spaces().catch(() => [])]);
      setDrill(d);
      setSpaces(s);
      if (!spaceId && s[0]) setSpaceId(s[0].id);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  };

  const shown = useMemo(() => (drill ? drill.items.filter((i) => filter === 'all' || i.coverage === filter) : []), [drill, filter]);
  const chosen = drill ? drill.items.filter((i) => picks[i.id]?.on && i.key).map((i) => ({ key: i.key!, title: i.title, to: picks[i.id]!.to })) : [];

  const doReassign = async () => {
    setBusy(true);
    try {
      const r = await api.reassign(chosen.map(({ key, to }) => ({ key, to })));
      setReceipts(r);
      setPicks((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, on: false }])));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };

  const doHandover = async () => {
    if (!drill) return;
    setBusy(true);
    try {
      const r = await api.handover(drill.person.accountId, drill.window, spaceId);
      setPage(r.url);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };

  return (
    <div className={`app ${drill ? 'has-drill' : ''}`}>
      <header className="top">
        <span className="brand">
          <span className="brand-dot" aria-hidden="true" />
          Standby
        </span>
        <span className="top-note">Bus-factor fire drill for Jira and Confluence</span>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title" className="hero-title">
          <span className="line">If this person is out,</span>
          <span className="line">
            what <em>stalls</em>?
          </span>
        </h1>
        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <PersonPicker value={person} onChange={setPerson} />
          <div className="dates">
            <label>
              <span>Out from</span>
              <input type="date" value={win.from} onChange={(e) => setWin((w) => ({ ...w, from: e.target.value }))} />
            </label>
            <label>
              <span>Back on</span>
              <input type="date" value={win.to} min={win.from} onChange={(e) => setWin((w) => ({ ...w, to: e.target.value }))} />
            </label>
          </div>
          <button className="btn hot run" disabled={!person || loading}>
            {loading ? 'Running drill…' : drill ? 'Run again' : 'Run the drill'}
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      {loading && (
        <section className="scan" aria-live="polite">
          <div className="scan-orb" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p key={step} className="scan-step">
            {STEPS[step]}…
          </p>
        </section>
      )}

      {drill && !loading && (
        <main className="result" aria-label={`Drill for ${drill.person.name}`}>
          <div className="stage">
            <Orbit person={drill.person} items={drill.items} focus={focus} onFocus={setFocus} />
            <ul className="legend">
              {(['stalls', 'thin', 'covered'] as const).map((c) => (
                <li key={c}>
                  <span className={`dot-key dot-${c}`} aria-hidden="true" />
                  {coverageText[c].long}
                </li>
              ))}
            </ul>
            <ul className="sources" aria-label="Where this came from">
              {drill.sources.map((s) => (
                <li key={s.source} className={s.ok ? 'ok' : 'warn'} title={s.note}>
                  <strong>{s.label}</strong> {s.ok ? `${s.count} items` : 'partial'}
                  <span>{s.note}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel">
            <p className="kicker">
              {drill.person.name} · out {fmtDate(drill.window.from)} to {fmtDate(drill.window.to)}
            </p>
            <div className="kpis">
              {(['stalls', 'thin', 'covered'] as const).map((c) => (
                <button key={c} type="button" className={`kpi kpi-${c} ${filter === c ? 'on' : ''}`} onClick={() => setFilter((f) => (f === c ? 'all' : c))} aria-pressed={filter === c}>
                  <span className="kpi-n">
                    <CountUp value={drill.counts[c]} />
                  </span>
                  <span className="kpi-l">{coverageText[c].label}</span>
                </button>
              ))}
            </div>

            {drill.bench.length > 0 && (
              <section className="bench" aria-labelledby="bench-title">
                <h2 id="bench-title">Who can pick it up</h2>
                <ol>
                  {drill.bench.slice(0, 5).map((b, i) => (
                    <li key={b.person.accountId} style={{ animationDelay: `${200 + i * 70}ms` }}>
                      <Avatar person={b.person} size={36} />
                      <span className="bench-name">{b.person.name}</span>
                      <span className="bench-n">{b.items.length} items</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {drill.items.length === 0 ? (
              <p className="empty">Standby found no open work, owned pages or projects for {drill.person.name} that you can see.</p>
            ) : (
              <ul className="cards">
                {shown.map((item, i) => (
                  <ItemCard key={item.id} item={item} index={i} focused={focus === item.id} pick={picks[item.id]} onFocus={setFocus} onPick={(id, v) => setPicks((p) => ({ ...p, [id]: v }))} />
                ))}
              </ul>
            )}

            {(receipts.length > 0 || page) && (
              <section className="receipts" aria-live="polite">
                {receipts.map((r) => (
                  <p key={r.key} className={r.ok ? 'ok' : 'warn'}>
                    {r.ok ? `${r.key} now assigned to ${r.to.name}` : `${r.key}: ${r.error}`}
                  </p>
                ))}
                {page && (
                  <p className="ok">
                    Handover draft created.{' '}
                    <button type="button" className="link" onClick={() => api.open(page)}>
                      Open it in Confluence ↗
                    </button>
                  </p>
                )}
              </section>
            )}
          </div>

          <div className="dock" role="region" aria-label="Actions">
            <label className="dock-space">
              <span>Handover space</span>
              <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)} disabled={!spaces.length}>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn ghost" disabled={!spaceId} onClick={() => setAsk('handover')}>
              Draft handover page
            </button>
            <button type="button" className="btn hot" disabled={!chosen.length} onClick={() => setAsk('reassign')}>
              Reassign {chosen.length || ''} {chosen.length === 1 ? 'issue' : 'issues'}
            </button>
          </div>
        </main>
      )}

      {ask === 'reassign' && (
        <Confirm title={`Reassign ${chosen.length} Jira ${chosen.length === 1 ? 'issue' : 'issues'}?`} action="Reassign in Jira" busy={busy} onCancel={() => setAsk(null)} onConfirm={doReassign}>
          <p>Each issue below changes assignee in Jira, as you. Nothing else changes.</p>
          <ul className="confirm-list">
            {chosen.map((c) => (
              <li key={c.key}>
                <strong>{c.key}</strong> {c.title} → {c.to.name}
              </li>
            ))}
          </ul>
        </Confirm>
      )}
      {ask === 'handover' && drill && (
        <Confirm title="Create the handover draft?" action="Create draft" busy={busy} onCancel={() => setAsk(null)} onConfirm={doHandover}>
          <p>
            Standby re-reads the live data and creates one <strong>draft</strong> page in <strong>{spaces.find((s) => s.id === spaceId)?.name}</strong>, titled "Handover: {drill.person.name}, {drill.window.from} to {drill.window.to}". It lists every item above with its
            suggested backup. Nobody sees it until you publish it.
          </p>
        </Confirm>
      )}
    </div>
  );
}
