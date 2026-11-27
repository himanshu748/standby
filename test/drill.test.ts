import { describe, expect, it } from 'vitest';
import { backupsFor, coverageOf, mergeItems, runDrill, urgencyOf } from '../src/core/drill';
import { escapeXml, handoverBrief, handoverStorage, handoverTitle } from '../src/core/handover';
import { nodeAngle, orbit, ringLabelAngle } from '../src/core/layout';
import type { Person, Signals, Touch, WorkItem } from '../src/core/model';

// Names are real users on the development site (one-atlas-obka); ids are shortened.
const alana: Person = { accountId: 'alana', name: 'Alana Grant' };
const mitch: Person = { accountId: 'mitch', name: 'Mitch Davis' };
const cassi: Person = { accountId: 'cassi', name: 'Cassi Owens' };
const emma: Person = { accountId: 'emma', name: 'Emma Paris' };
const t = (p: Person, how = 'edited it'): Touch => ({ ...p, how });
const window = { from: '2026-12-01', to: '2026-12-12' };

const issue = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: 'jira:SALES-27',
  kind: 'issue',
  key: 'SALES-27',
  title: 'Renewal quote',
  url: 'https://x/browse/SALES-27',
  container: { id: 'jira:SALES', name: 'Sales' },
  roles: ['assignee'],
  sources: ['jira'],
  touchedBy: [],
  ...over,
});

const signals = (items: WorkItem[], over: Partial<Signals> = {}): Signals => ({
  person: alana,
  items,
  containerPeers: { 'jira:SALES': [{ person: mitch, note: '4 open in Sales' }, { person: alana, note: '9 open in Sales' }] },
  teammates: [{ person: cassi, team: 'Revenue' }],
  sources: [],
  ...over,
});

describe('coverageOf', () => {
  it('ignores the person who is out and counts distinct others', () => {
    expect(coverageOf(issue({ touchedBy: [t(alana)] }), 'alana')).toBe('stalls');
    expect(coverageOf(issue({ touchedBy: [t(mitch), t(mitch)] }), 'alana')).toBe('thin');
    expect(coverageOf(issue({ touchedBy: [t(mitch), t(emma)] }), 'alana')).toBe('covered');
  });
});

describe('urgencyOf', () => {
  it('scores due dates relative to the absence and explains each point', () => {
    expect(urgencyOf(issue({ dueAt: '2026-11-20' }), window)).toEqual({ score: 4, notes: ['already overdue'] });
    expect(urgencyOf(issue({ dueAt: '2026-12-05' }), window).score).toBe(3);
    expect(urgencyOf(issue({ dueAt: '2026-12-12' }), window)).toEqual({ score: 1, notes: ['due the week they return'] });
    expect(urgencyOf(issue({ dueAt: '2026-12-18' }), window).score).toBe(1);
    expect(urgencyOf(issue({ dueAt: '2027-02-01' }), window).score).toBe(0);
  });
  it('adds priority, active status and ownership', () => {
    const r = urgencyOf(issue({ priority: 'High', status: 'In Progress', kind: 'project-lead' }), window);
    expect(r.score).toBe(5);
    expect(r.notes).toEqual(['High priority', 'in "In Progress"', 'they are the named owner']);
  });
});

describe('backupsFor', () => {
  it('ranks people who touched the item above peers and teammates, never the person who is out', () => {
    const c = backupsFor(issue({ touchedBy: [t(emma), t(alana)] }), signals([]));
    expect(c.map((x) => x.person.name)).toEqual(['Emma Paris', 'Mitch Davis', 'Cassi Owens']);
    expect(c[1]?.reasons[0]?.text).toBe('4 open in Sales');
  });
  it('stacks reasons for one person once per kind', () => {
    const c = backupsFor(issue({ touchedBy: [t(mitch)] }), signals([]));
    expect(c[0]).toMatchObject({ person: mitch, score: 5 });
    expect(c[0]?.reasons.map((r) => r.kind)).toEqual(['touched', 'peer']);
  });
  it('returns nobody when the graph has nobody', () => {
    expect(backupsFor(issue(), signals([], { containerPeers: {}, teammates: [] }))).toEqual([]);
  });
});

describe('runDrill', () => {
  it('orders stalls first by urgency and builds a bench of top backups', () => {
    const d = runDrill(
      signals([
        issue({ id: 'a', title: 'covered', touchedBy: [t(mitch), t(emma)] }),
        issue({ id: 'b', title: 'stalls later', dueAt: '2027-03-01' }),
        issue({ id: 'c', title: 'stalls now', dueAt: '2026-12-03' }),
        issue({ id: 'd', title: 'thin', touchedBy: [t(emma)], container: { id: 'conf:HR', name: 'HR' } }),
      ]),
      window,
    );
    expect(d.items.map((i) => i.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(d.counts).toEqual({ stalls: 2, thin: 1, covered: 1 });
    expect(d.bench.map((b) => [b.person.name, b.items])).toEqual([
      ['Mitch Davis', ['c', 'b']],
      ['Emma Paris', ['d']],
    ]);
  });
});

describe('mergeItems', () => {
  it('unions roles, sources and people for the same work, filling gaps', () => {
    const [m, ...rest] = mergeItems([
      issue({ touchedBy: [t(mitch)] }),
      issue({ sources: ['graph'], roles: ['assignee', 'reporter'], touchedBy: [t(mitch), t(emma)], dueAt: '2026-12-02' }),
    ]);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ sources: ['jira', 'graph'], roles: ['assignee', 'reporter'], dueAt: '2026-12-02' });
    expect(m?.touchedBy.map((p) => p.name)).toEqual(['Mitch Davis', 'Emma Paris']);
  });
});

describe('handover', () => {
  it('keeps partial coverage and the selected backup in the text brief', () => {
    const d = runDrill(signals([
      issue({ id: 'missing', container: { id: 'jira:OTHER', name: 'Other' }, dueAt: '2026-12-03' }),
      issue({ id: 'picked', key: 'SALES-32', url: 'https://x/browse/SALES-32', touchedBy: [t(emma)] }),
    ], {
      teammates: [],
      sources: [{ source: 'graph', label: 'Teamwork Graph', ok: false, count: 1, note: 'Some relationships were unavailable' }],
    }), window);

    const brief = handoverBrief(d, { picked: mitch.accountId });
    expect(brief).toContain('Handover: Alana Grant, 2026-12-01 to 2026-12-12');
    expect(brief).toContain('Teamwork Graph: partial (1 item found) (Some relationships were unavailable)');
    expect(brief).toContain('SALES-27 Renewal quote | https://x/browse/SALES-27\n  Suggested backup: Nobody found in this drill');
    expect(brief).toContain('SALES-32 Renewal quote | https://x/browse/SALES-32\n  Suggested backup: Mitch Davis (4 open in Sales)');
    expect(handoverBrief(d, { picked: 'unavailable' })).toContain('Suggested backup: Emma Paris (edited it)');
  });

  it('carries partial source coverage into the Confluence handover draft', () => {
    const d = runDrill(signals([issue()], {
      sources: [
        { source: 'graph', label: 'Graph & relationships', ok: false, count: 0 },
        { source: 'jira', label: 'Jira', ok: true, count: 1 },
      ],
    }), window);
    const body = handoverStorage(d);
    expect(body).toContain('1 item(s) with no other recorded contributor');
    expect(body).toContain('<h2>Source coverage</h2>');
    expect(body).toContain('Source coverage is incomplete.');
    expect(body).toContain('<li>Graph &amp; relationships: partial (0 items found)</li>');
    expect(body).toContain('<li>Jira: 1 item</li>');
  });

  it('escapes user content and lists every section that has items', () => {
    const d = runDrill(signals([issue({ title: 'Quote <draft> & "v2"', dueAt: '2026-12-03' })]), window);
    const body = handoverStorage(d);
    expect(handoverTitle(d)).toBe('Handover: Alana Grant, 2026-12-01 to 2026-12-12');
    expect(body).toContain('SALES-27 Quote &lt;draft&gt; &amp; &quot;v2&quot;');
    expect(body).toContain('<h2>Stalls without them (1)</h2>');
    expect(body).not.toContain('<h2>Covered');
    expect(body).toContain('Mitch Davis (4 open in Sales)');
    expect(escapeXml(`a'b`)).toBe('a&#39;b');
    expect(handoverStorage(d, { [d.items[0]!.id]: 'not-a-backup' })).toContain('Mitch Davis (4 open in Sales)');
    expect(body).toContain('<li><strong>Mitch Davis</strong>: 1 item(s)</li>');
  });
});

describe('orbit', () => {
  it('puts stalls on the outer ring and stays inside the box', () => {
    const d = runDrill(signals([issue({ id: 'x' }), issue({ id: 'y', touchedBy: [t(mitch), t(emma)] })]), window);
    const placed = orbit(d.items, 400);
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - 200, p.y - 200);
    const [s, c] = [placed.find((p) => p.id === 'x')!, placed.find((p) => p.id === 'y')!];
    expect(dist(s)).toBeGreaterThan(dist(c));
    for (const p of placed) expect(dist(p) + p.r).toBeLessThanOrEqual(200);
  });

  it('puts each ring label in the gap between nodes', () => {
    const apart = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    for (const [count, ring] of [
      [5, 2],
      [3, 1],
      [1, 0],
    ] as const) {
      const label = ringLabelAngle(count, ring);
      for (let i = 0; i < count; i++) expect(apart(label, nodeAngle(ring, i, count))).toBeGreaterThan(0.4);
    }
  });

  it('shrinks nodes on a crowded ring so they never overlap', () => {
    const many = Array.from({ length: 60 }, (_, i) => issue({ id: `n${i}`, priority: 'Highest' }));
    const placed = orbit(runDrill(signals(many), window).items, 400);
    const [a, b] = [placed[0]!, placed[1]!];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
  });
});
