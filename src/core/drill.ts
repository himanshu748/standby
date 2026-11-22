import type { AssessedItem, BenchEntry, Candidate, Coverage, Drill, Person, Signals, Touch, WorkItem } from './model';

const DAY = 86_400_000;

export function coverageOf(item: WorkItem, outId: string): Coverage {
  const others = new Set(item.touchedBy.filter((p) => p.accountId !== outId).map((p) => p.accountId)).size;
  return others === 0 ? 'stalls' : others === 1 ? 'thin' : 'covered';
}

/** Higher means it hurts sooner. Notes explain every point so the UI never shows a bare number. */
export function urgencyOf(item: WorkItem, window: { from: string; to: string }): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0;
  if (item.dueAt) {
    const due = Date.parse(item.dueAt);
    const from = Date.parse(window.from);
    const to = Date.parse(window.to);
    if (due < from) {
      score += 4;
      notes.push('already overdue');
    } else if (due <= to + DAY) {
      score += 3;
      notes.push('due while they are out');
    } else if (due <= to + 7 * DAY) {
      score += 1;
      notes.push('due the week they return');
    }
  }
  if (item.priority && /highest|high|critical|blocker/i.test(item.priority)) {
    score += 2;
    notes.push(`${item.priority} priority`);
  }
  if (item.status && /progress|review|doing|waiting|approv/i.test(item.status)) {
    score += 1;
    notes.push(`in "${item.status}"`);
  }
  if (item.kind === 'project-lead' || item.kind === 'goal' || item.kind === 'atlas-project') {
    score += 2;
    notes.push('they are the named owner');
  }
  return { score, notes };
}

export function backupsFor(item: WorkItem, signals: Signals, max = 3): Candidate[] {
  const outId = signals.person.accountId;
  const byId = new Map<string, Candidate>();
  const add = (person: Person, points: number, reason: Candidate['reasons'][number]) => {
    if (person.accountId === outId) return;
    const c = byId.get(person.accountId) ?? { person, score: 0, reasons: [] };
    if (c.reasons.some((r) => r.kind === reason.kind)) return;
    c.score += points;
    c.reasons.push(reason);
    byId.set(person.accountId, c);
  };
  for (const p of item.touchedBy) add(p, 3, { kind: 'touched', text: p.how });
  const peers = item.container ? (signals.containerPeers[item.container.id] ?? []) : [];
  for (const { person, note } of peers) add(person, 2, { kind: 'peer', text: note });
  for (const { person, team } of signals.teammates) add(person, 1, { kind: 'teammate', text: `same team: ${team}` });
  return [...byId.values()].sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name)).slice(0, max);
}

const order: Record<Coverage, number> = { stalls: 0, thin: 1, covered: 2 };

export function runDrill(signals: Signals, window: { from: string; to: string }): Drill {
  const outId = signals.person.accountId;
  const items: AssessedItem[] = signals.items
    .map((item) => {
      const { score, notes } = urgencyOf(item, window);
      return { ...item, coverage: coverageOf(item, outId), urgency: score, urgencyNotes: notes, backups: backupsFor(item, signals) };
    })
    .sort((a, b) => order[a.coverage] - order[b.coverage] || b.urgency - a.urgency || a.title.localeCompare(b.title));

  const bench = new Map<string, BenchEntry>();
  for (const item of items) {
    if (item.coverage === 'covered') continue;
    const top = item.backups[0];
    if (!top) continue;
    const entry = bench.get(top.person.accountId) ?? { person: top.person, score: 0, items: [] };
    entry.score += top.score + item.urgency;
    entry.items.push(item.id);
    bench.set(top.person.accountId, entry);
  }

  const counts: Record<Coverage, number> = { stalls: 0, thin: 0, covered: 0 };
  for (const item of items) counts[item.coverage] += 1;

  return {
    person: signals.person,
    window,
    items,
    bench: [...bench.values()].sort((a, b) => b.score - a.score),
    counts,
    sources: signals.sources,
  };
}

/** Merge items describing the same work (e.g. a Jira issue seen via REST and via Teamwork Graph). */
export function mergeItems(items: WorkItem[]): WorkItem[] {
  const byId = new Map<string, WorkItem>();
  for (const item of items) {
    const prev = byId.get(item.id);
    if (!prev) {
      byId.set(item.id, { ...item, roles: [...item.roles], sources: [...item.sources], touchedBy: [...item.touchedBy] });
      continue;
    }
    for (const r of item.roles) if (!prev.roles.includes(r)) prev.roles.push(r);
    for (const s of item.sources) if (!prev.sources.includes(s)) prev.sources.push(s);
    for (const p of item.touchedBy) if (!prev.touchedBy.some((q: Touch) => q.accountId === p.accountId)) prev.touchedBy.push(p);
    for (const k of ['dueAt', 'status', 'priority', 'container', 'updatedAt', 'key'] as const) {
      if (prev[k] === undefined && item[k] !== undefined) Object.assign(prev, { [k]: item[k] });
    }
  }
  return [...byId.values()];
}
