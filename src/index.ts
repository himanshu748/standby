import api, { assumeTrustedRoute } from '@forge/api';
import Resolver from '@forge/resolver';
import { listSpaces, lookupPeople } from './adapters/confluence';
import type { Graph, Rest } from './adapters/http';
import { searchUsers } from './adapters/jira';
import { createHandover as createDraft, drill as runDrill, issueCover as runIssueDrill, reassignIssues, type Clients, type DrillInput } from './service';

export type { Clients } from './service';

const init = (i?: { method?: string; body?: string }) =>
  i ? { method: i.method ?? 'GET', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, ...(i.body ? { body: i.body } : {}) } : { headers: { Accept: 'application/json' } };
const jira: Rest = (path, i) => api.asUser().requestJira(assumeTrustedRoute(path), init(i));
const conf: Rest = (path, i) => api.asUser().requestConfluence(assumeTrustedRoute(path), init(i));
const graph: Graph = async (query, variables) => {
  const response = await api.asUser().requestTeamworkGraph(query, variables);
  if (!response.ok) throw new Error(`Teamwork Graph returned HTTP ${response.status}`);
  return response.json();
};

const clients = { jira, conf, graph };

export const drill = (payload: DrillInput, requestClients: Clients = clients) => runDrill(payload, requestClients);
export const issueCover = (payload: Parameters<typeof runIssueDrill>[0]) => runIssueDrill(payload, clients);
export const createHandover = (payload: Parameters<typeof createDraft>[0], requestClients: Clients = clients) => createDraft(payload, requestClients);

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
  const { page } = await createHandover(payload as Parameters<typeof createDraft>[0]);
  return page;
});

resolver.define('reassign', async ({ payload }) => reassignIssues(payload as Parameters<typeof reassignIssues>[0], jira));

export const handler = resolver.getDefinitions();
