import api, { assumeTrustedRoute } from '@forge/api';
import Resolver from '@forge/resolver';
import { mergeItems, runDrill } from './core/drill';
import { handoverStorage, handoverTitle } from './core/handover';
import type { Drill, Person, SourceStatus } from './core/model';
import { confluenceSignals, createDraft, listSpaces, lookupPeople } from './adapters/confluence';
import { graphSignals } from './adapters/graph';
import type { Graph, Rest } from './adapters/http';
import { jiraSignals, reassign, searchUsers } from './adapters/jira';

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
    graphSignals(graph, p.accountId),
  ]);
  const sources: SourceStatus[] = [
    j.status === 'fulfilled'
      ? { source: 'jira', label: 'Jira', ok: true, count: j.value.items.length, note: `${j.value.issueCount} open issues assigned` }
      : { source: 'jira', label: 'Jira', ok: false, count: 0, note: fail(j.reason) },
    c.status === 'fulfilled'
      ? { source: 'confluence', label: 'Confluence', ok: true, count: c.value.items.length, note: `${c.value.pageCount} recent pages they wrote or edited` }
      : { source: 'confluence', label: 'Confluence', ok: false, count: 0, note: fail(c.reason) },
    g.status === 'fulfilled'
      ? {
          source: 'graph',
          label: 'Teamwork Graph',
          ok: g.value.errors.length === 0,
          count: g.value.items.length,
          note: [
            `${g.value.counts.work} open work items, ${g.value.counts.pages} pages, ${g.value.counts.owned} projects or goals they own`,
            g.value.teams.length ? `teams: ${g.value.teams.join(', ')}` : 'no teams found',
            ...g.value.errors,
          ].join('; '),
        }
      : { source: 'graph', label: 'Teamwork Graph', ok: false, count: 0, note: fail(g.reason) },
  ];
  const items = mergeItems([
    ...(j.status === 'fulfilled' ? j.value.items : []),
    ...(c.status === 'fulfilled' ? c.value.items : []),
    ...(g.status === 'fulfilled' ? g.value.items : []),
  ]);
  return runDrill(
    {
      person,
      items,
      containerPeers: { ...(j.status === 'fulfilled' ? j.value.peers : {}), ...(c.status === 'fulfilled' ? c.value.peers : {}) },
      teammates: g.status === 'fulfilled' ? g.value.teammates : [],
      sources,
    },
    { from: p.from, to: p.to },
  );
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

resolver.define('spaces', async () => listSpaces(conf));

resolver.define('handover', async ({ payload }) => {
  const p = payload as DrillInput & { spaceId: string; confirmed: boolean };
  if (p.confirmed !== true) throw new Error('Confirm before creating the page');
  if (!/^\d+$/.test(String(p.spaceId))) throw new Error('Pick a space');
  const d = await drill(p);
  return createDraft(conf, String(p.spaceId), handoverTitle(d), handoverStorage(d));
});

resolver.define('reassign', async ({ payload }) => {
  const p = payload as { changes: { key: string; to: Person }[]; confirmed: boolean };
  if (p.confirmed !== true) throw new Error('Confirm before reassigning');
  const changes = (p.changes ?? []).slice(0, 25);
  const results = await Promise.allSettled(changes.map((c) => reassign(jira, c.key, c.to.accountId)));
  return changes.map((c, i) => {
    const r = results[i];
    return { key: c.key, to: c.to, ok: r?.status === 'fulfilled', error: r?.status === 'rejected' ? fail(r.reason) : undefined };
  });
});

export const handler = resolver.getDefinitions();
