import api, { assumeTrustedRoute } from '@forge/api';
import Resolver from '@forge/resolver';
import { mergeItems, runDrill } from './core/drill';
import { handoverStorage, handoverTitle } from './core/handover';
import type { Drill, IssueCover, Person, Signals, SourceStatus, WorkItem } from './core/model';
import { confluenceSignals, createDraft, listSpaces, lookupPeople } from './adapters/confluence';
import { graphCoverage, graphSignals } from './adapters/graph';
import { getJson, q, type Graph, type Rest } from './adapters/http';
import { FIELDS, jiraSignals, parseIssues, parsePeers, reassign, searchUsers } from './adapters/jira';
import { toPerson } from './adapters/people';

const init = (i?: { method?: string; body?: string }) =>
  i ? { method: i.method ?? 'GET', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, ...(i.body ? { body: i.body } : {}) } : { headers: { Accept: 'application/json' } };
const jira: Rest = (path, i) => api.asUser().requestJira(assumeTrustedRoute(path), init(i));
const conf: Rest = (path, i) => api.asUser().requestConfluence(assumeTrustedRoute(path), init(i));
const graph: Graph = async (query, variables) => (await api.asUser().requestTeamworkGraph(query, variables)).json();

type DrillInput = { accountId: string; from: string; to: string; siteUrl: string };

const ACCOUNT = /^[A-Za-z0-9:_-]{6,128}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function check(p: DrillInput): void {
  if (!ACCOUNT.test(p.accountId ?? '')) throw new Error('Pick a person first');
  if (!DATE.test(p.from ?? '') || !DATE.test(p.to ?? '') || p.from > p.to) throw new Error('Pick a valid absence window');
  if (!/^https:\/\/[a-z0-9-]+\.(atlassian\.net|jira\.com)$/.test(p.siteUrl ?? '')) throw new Error('Unknown site');
}

const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function drill(p: DrillInput): Promise<Drill> {
  check(p);
  const [person] = [...(await lookupPeople(jira, [p.accountId])).values()];
  if (!person) throw new Error('That person is not an active user on this site');
  const [j, c, g] = await Promise.allSettled([
    jiraSignals(jira, p.siteUrl, p.accountId),
    confluenceSignals(conf, jira, p.siteUrl, p.accountId),
    graphSignals(graph, p.accountId, p.siteUrl),
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
      ? { source: 'jira', label: 'Jira', ok: true, count: j.value.items.length, note: `${j.value.more ? 'first ' : ''}${j.value.issueCount} open issues assigned` }
      : { source: 'jira', label: 'Jira', ok: false, count: 0, note: fail(j.reason) },
    c.status === 'fulfilled'
      ? { source: 'confluence', label: 'Confluence', ok: true, count: c.value.items.length, note: `${c.value.pageCount} recent pages they wrote or edited` }
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
  const pool = candidatePool(p.accountId, merged, containerPeers, teammates);
  const co = await graphCoverage(graph, merged, pool).catch(() => undefined);
  const graphSource = sources.find((s) => s.source === 'graph');
  if (co && graphSource) graphSource.note = `${near.size} objects in their graph, ${co.links} also in ${co.checked} colleagues' graphs; ${graphSource.note ?? ''}`;
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
export async function issueCover(p: { issueKey: string; from: string; to: string; siteUrl: string }): Promise<IssueCover> {
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(p.issueKey ?? '')) throw new Error('Not an issue key');
  check({ ...p, accountId: 'issue-panel' });
  const issue = await getJson(jira, `/rest/api/3/issue/${p.issueKey}?${q({ fields: `${FIELDS},assignee`, expand: 'changelog' })}`);
  const person = toPerson(issue.fields?.assignee) ?? null;
  if (!person) return { person, item: null, sources: [] };
  const [item] = parseIssues({ issues: [issue] }, p.siteUrl, person.accountId);
  const project = String(issue.fields?.project?.key ?? '').replace(/"/g, '');
  const peersJql = `project = "${project}" AND statusCategory != Done AND assignee is not EMPTY`;
  const [peersRes, g] = await Promise.allSettled([
    getJson(jira, `/rest/api/3/search/jql?${q({ jql: peersJql, fields: 'assignee,project', maxResults: 100 })}`),
    graphSignals(graph, person.accountId, p.siteUrl),
  ]);
  const containerPeers = peersRes.status === 'fulfilled' ? parsePeers(peersRes.value) : {};
  const teammates = g.status === 'fulfilled' ? g.value.teammates : [];
  if (g.status === 'fulfilled' && g.value.neighbourhood.has(item!.id)) item!.sources.push('graph');
  const pool = candidatePool(person.accountId, [item!], containerPeers, teammates);
  const co = g.status === 'fulfilled' ? await graphCoverage(graph, [item!], pool).catch(() => undefined) : undefined;
  const graphNote =
    g.status === 'rejected'
      ? fail(g.reason)
      : [
          co ? `checked ${co.checked} colleagues' graphs, ${co.links} also hold this issue` : "colleagues' graphs not checked",
          g.value.teams.length ? `teams: ${g.value.teams.join(', ')}` : 'not on any team',
          ...g.value.errors,
        ].join('; ');
  const sources: SourceStatus[] = [
    { source: 'jira', label: 'Jira', ok: peersRes.status === 'fulfilled', count: 1, note: peersRes.status === 'fulfilled' ? `history, comments and ${project} teammates` : fail(peersRes.reason) },
    { source: 'graph', label: 'Teamwork Graph', ok: g.status === 'fulfilled' && g.value.errors.length === 0 && !!co, count: co?.links ?? 0, note: graphNote },
  ];
  const d = runDrill({ person, items: co?.items ?? [item!], containerPeers, teammates, sources }, { from: p.from, to: p.to });
  return { person, item: d.items[0] ?? null, sources };
}

/** The people most often near the person's work, whose Teamwork Graph neighbourhoods are worth checking. */
function candidatePool(outId: string, items: WorkItem[], peers: Signals['containerPeers'], teammates: Signals['teammates'], max = 12): Person[] {
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
  return [...seen.values()].sort((a, b) => b.n - a.n).slice(0, max).map((e) => e.person);
}

const resolver = new Resolver();

resolver.define('people', async ({ payload }) => {
  const query = String(payload['query'] ?? '').trim().slice(0, 60);
  return query.length < 2 ? [] : searchUsers(jira, query);
});

resolver.define('me', async ({ context }) => {
  const [me] = [...(await lookupPeople(jira, [context.accountId as string])).values()];
  return me ?? null;
});

resolver.define('drill', async ({ payload }) => drill(payload as DrillInput));
resolver.define('issue', async ({ payload, context }) =>
  issueCover({ ...(payload as { from: string; to: string; siteUrl: string }), issueKey: String((context.extension as { issue?: { key?: string } })?.issue?.key ?? '') }),
);


resolver.define('spaces', async () => listSpaces(conf));

resolver.define('handover', async ({ payload }) => {
  const p = payload as DrillInput & { spaceId: string; confirmed: boolean; picks?: Record<string, string> };
  if (p.confirmed !== true) throw new Error('Confirm before creating the page');
  if (!/^\d+$/.test(String(p.spaceId))) throw new Error('Pick a space');
  const d = await drill(p);
  return createDraft(conf, String(p.spaceId), handoverTitle(d), handoverStorage(d, p.picks ?? {}));
});

resolver.define('reassign', async ({ payload }) => {
  const p = payload as { changes: { key: string; to: Person }[]; confirmed: boolean };
  if (p.confirmed !== true) throw new Error('Confirm before reassigning');
  const changes = p.changes ?? [];
  if (changes.length > 50) throw new Error('Reassign at most 50 issues at a time');
  const results = await Promise.allSettled(changes.map((c) => reassign(jira, c.key, c.to.accountId)));
  return changes.map((c, i) => {
    const r = results[i];
    return { key: c.key, to: c.to, ok: r?.status === 'fulfilled', error: r?.status === 'rejected' ? fail(r.reason) : undefined };
  });
});

export const handler = resolver.getDefinitions();
