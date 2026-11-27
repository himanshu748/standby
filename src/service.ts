import { mergeItems, runDrill } from './core/drill';
import { handoverStorage, handoverTitle } from './core/handover';
import type { Drill, IssueCover, Person, Signals, SourceStatus, WorkItem } from './core/model';
import { confluenceSignals, createDraft, lookupPeople } from './adapters/confluence';
import { graphCoverage, graphSignals } from './adapters/graph';
import { getJson, q, type Graph, type Rest } from './adapters/http';
import { FIELDS, hasMoreJiraResults, hasTruncatedIssueEvidence, jiraSignals, parseIssues, parsePeers, reassign } from './adapters/jira';
import { toPerson } from './adapters/people';

export type Clients = { jira: Rest; conf: Rest; graph: Graph };

export type DrillInput = { accountId: string; from: string; to: string; siteUrl: string };

const ACCOUNT = /^[A-Za-z0-9:_-]{6,128}$/;
function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function check(p: DrillInput): void {
  if (!ACCOUNT.test(p.accountId ?? '')) throw new Error('Pick a person first');
  if (!isCalendarDay(p.from) || !isCalendarDay(p.to) || p.from > p.to) throw new Error('Pick a valid absence window');
  if (!/^https:\/\/[a-z0-9-]+\.(atlassian\.net|jira\.com)$/.test(p.siteUrl ?? '')) throw new Error('Unknown site');
}

const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function drill(p: DrillInput, clients: Clients): Promise<Drill> {
  check(p);
  const [person] = [...(await lookupPeople(clients.jira, [p.accountId])).values()];
  if (!person) throw new Error('That person is not an active user on this site');
  const [j, c, g] = await Promise.allSettled([
    jiraSignals(clients.jira, p.siteUrl, p.accountId),
    confluenceSignals(clients.conf, clients.jira, p.siteUrl, p.accountId),
    graphSignals(clients.graph, p.accountId, p.siteUrl),
  ]);
  const sources: SourceStatus[] = [
    g.status === 'fulfilled'
      ? {
          source: 'graph',
          label: 'Teamwork Graph',
          ok: g.value.errors.length === 0,
          count: g.value.items.length,
          note: [
            `${g.value.counts.work} open work items, ${g.value.counts.pages} pages, ${g.value.counts.owned} projects or goals they own`,
            g.value.teams.length ? `teams: ${g.value.teams.join(', ')}` : 'not on any team',
            ...g.value.errors,
          ].join('; '),
        }
      : { source: 'graph', label: 'Teamwork Graph', ok: false, count: 0, note: fail(g.reason) },
    j.status === 'fulfilled'
      ? {
          source: 'jira',
          label: 'Jira',
          ok: !j.value.more && j.value.warnings.length === 0,
          count: j.value.items.length,
          note: [
            ...(j.value.issueCount === null ? [] : [`${j.value.more ? 'first ' : ''}${j.value.issueCount} open issues assigned`]),
            ...j.value.warnings,
          ].join('; '),
        }
      : { source: 'jira', label: 'Jira', ok: false, count: 0, note: fail(j.reason) },
    c.status === 'fulfilled'
      ? {
          source: 'confluence',
          label: 'Confluence',
          ok: c.value.warnings.length === 0,
          count: c.value.items.length,
          note: [`${c.value.pageCount} recent pages they wrote or edited`, ...c.value.warnings].join('; '),
        }
      : { source: 'confluence', label: 'Confluence', ok: false, count: 0, note: fail(c.reason) },
  ];
  const merged = mergeItems([
    ...(j.status === 'fulfilled' ? j.value.items : []),
    ...(c.status === 'fulfilled' ? c.value.items : []),
    ...(g.status === 'fulfilled' ? g.value.items : []),
  ]);
  const containerPeers = { ...(j.status === 'fulfilled' ? j.value.peers : {}), ...(c.status === 'fulfilled' ? c.value.peers : {}) };
  const teammates = g.status === 'fulfilled' ? g.value.teammates : [];
  const near = g.status === 'fulfilled' ? g.value.neighbourhood : new Set<string>();
  for (const i of merged) if (near.has(i.id) && !i.sources.includes('graph')) i.sources.push('graph');
  const { people, omitted } = candidatePool(p.accountId, merged, containerPeers, teammates);
  const co = await graphCoverage(clients.graph, merged, people).catch(() => undefined);
  const graphSource = sources.find((s) => s.source === 'graph');
  if (graphSource) {
    const checked = co?.checked ?? 0;
    const partial = co?.partial ?? 0;
    graphSource.ok = graphSource.ok && checked === people.length && partial === 0 && omitted === 0;
    const details = [
      co ? `${near.size} objects in their graph, ${co.links} also in ${checked} colleagues' graphs` : '',
      checked < people.length ? `${people.length - checked} colleague graph lookups failed` : '',
      partial > 0 ? `${partial} colleague graph responses were partial` : '',
      omitted > 0 ? `${omitted} additional colleague graph lookups were not run` : '',
      graphSource.note,
    ];
    graphSource.note = details.filter(Boolean).join('; ');
  }
  return runDrill(
    {
      person,
      items: co?.items ?? merged,
      containerPeers,
      teammates,
      sources,
    },
    { from: p.from, to: p.to },
  );
}

/** The drill for one issue: what happens to it if its assignee is out, and who could pick it up. */
export async function issueCover(p: { issueKey: string; from: string; to: string; siteUrl: string }, { jira, graph }: Clients): Promise<IssueCover> {
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(p.issueKey ?? '')) throw new Error('Not an issue key');
  check({ ...p, accountId: 'issue-panel' });
  const issue = await getJson(jira, `/rest/api/3/issue/${p.issueKey}?${q({ fields: `${FIELDS},assignee`, expand: 'changelog' })}`);
  const a = issue.fields?.assignee;
  // A deactivated assignee is the clearest case of someone being out, so keep them.
  const person: Person | null = toPerson(a) ??
    (a?.active === false && (a.accountType ?? 'atlassian') === 'atlassian' && a.accountId && a.displayName ? { accountId: a.accountId, name: a.displayName } : null);
  if (!person) return { person, item: null, sources: [] };
  if (issue.fields?.status?.statusCategory?.key === 'done') return { person, item: null, sources: [], done: true };
  const [item] = parseIssues({ issues: [issue] }, p.siteUrl, person.accountId);
  const project = String(issue.fields?.project?.key ?? '').replace(/"/g, '');
  const peersJql = `project = "${project}" AND statusCategory != Done AND assignee is not EMPTY`;
  const [peersRes, g] = await Promise.allSettled([
    getJson(jira, `/rest/api/3/search/jql?${q({ jql: peersJql, fields: 'assignee,project', maxResults: 100 })}`),
    graphSignals(graph, person.accountId, p.siteUrl),
  ]);
  const containerPeers = peersRes.status === 'fulfilled' ? parsePeers(peersRes.value) : {};
  const morePeers = peersRes.status === 'fulfilled' && hasMoreJiraResults(peersRes.value);
  const teammates = g.status === 'fulfilled' ? g.value.teammates : [];
  if (g.status === 'fulfilled' && g.value.neighbourhood.has(item!.id)) item!.sources.push('graph');
  const { people, omitted } = candidatePool(person.accountId, [item!], containerPeers, teammates);
  const co = g.status === 'fulfilled' ? await graphCoverage(graph, [item!], people).catch(() => undefined) : undefined;
  const graphNote =
    g.status === 'rejected'
      ? fail(g.reason)
      : [
          co ? `checked ${co.checked} colleagues' graphs, ${co.links} also hold this issue` : "colleagues' graphs not checked",
          ...(co && co.checked < people.length ? [`${people.length - co.checked} colleague graph lookups failed`] : []),
          ...(co && co.partial > 0 ? [`${co.partial} colleague graph responses were partial`] : []),
          ...(omitted > 0 ? [`${omitted} additional colleague graph lookups were not run`] : []),
          g.value.teams.length ? `teams: ${g.value.teams.join(', ')}` : 'not on any team',
          ...g.value.errors,
        ].join('; ');
  const partialEvidence = hasTruncatedIssueEvidence(issue);
  const jiraNotes = [peersRes.status === 'fulfilled' ? `history, comments and ${project} teammates` : fail(peersRes.reason)];
  if (morePeers) jiraNotes.push('additional colleague results were not read');
  if (partialEvidence) jiraNotes.push('additional issue evidence was not read');
  const sources: SourceStatus[] = [
    { source: 'jira', label: 'Jira', ok: peersRes.status === 'fulfilled' && !morePeers && !partialEvidence, count: 1, note: jiraNotes.join('; ') },
    { source: 'graph', label: 'Teamwork Graph', ok: g.status === 'fulfilled' && g.value.errors.length === 0 && co?.checked === people.length && co.partial === 0 && omitted === 0, count: co?.links ?? 0, note: graphNote },
  ];
  const d = runDrill({ person, items: co?.items ?? [item!], containerPeers, teammates, sources }, { from: p.from, to: p.to });
  return { person, item: d.items[0] ?? null, sources };
}

/** The people most often near the person's work, whose Teamwork Graph neighbourhoods are worth checking. */
function candidatePool(outId: string, items: WorkItem[], peers: Signals['containerPeers'], teammates: Signals['teammates']) {
  const seen = new Map<string, { person: Person; n: number }>();
  const bump = (person: Person, n: number) => {
    if (person.accountId === outId) return;
    const e = seen.get(person.accountId) ?? { person, n: 0 };
    e.n += n;
    seen.set(person.accountId, e);
  };
  for (const i of items) for (const t of i.touchedBy) bump(t, 2);
  for (const list of Object.values(peers)) for (const { person } of list) bump(person, 1);
  for (const { person } of teammates) bump(person, 3);
  const people = [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 12).map((entry) => entry.person);
  return { people, omitted: seen.size - people.length };
}

export async function createHandover(
  p: DrillInput & { spaceId: string; confirmed: boolean; picks?: Record<string, string> },
  clients: Clients,
): Promise<{ drill: Drill; page: { id: string; url: string } }> {
  if (p.confirmed !== true) throw new Error('Confirm before creating the page');
  if (!/^\d+$/.test(String(p.spaceId))) throw new Error('Pick a space');
  const d = await drill(p, clients);
  const page = await createDraft(clients.conf, p.siteUrl, String(p.spaceId), handoverTitle(d), handoverStorage(d, p.picks ?? {}));
  return { drill: d, page };
}

export async function reassignIssues(p: { changes: { key: string; to: Person }[]; confirmed: boolean }, client: Rest) {
  if (p.confirmed !== true) throw new Error('Confirm before reassigning');
  const changes = p.changes ?? [];
  if (changes.length > 50) throw new Error('Reassign at most 50 issues at a time');
  const results = await Promise.allSettled(changes.map((c) => reassign(client, c.key, c.to.accountId)));
  return changes.map((c, i) => {
    const r = results[i];
    return { key: c.key, to: c.to, ok: r?.status === 'fulfilled', error: r?.status === 'rejected' ? fail(r.reason) : undefined };
  });
}
