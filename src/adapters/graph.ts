import type { Person, Touch, WorkItem } from '../core/model';
import type { Graph, Json } from './http';
import { toPerson } from './people';

const user = (accountId: string) => `ari:cloud:identity::user/${accountId}`;
const U = '... on AtlassianUser { accountId name }';

export const QUERIES = {
  teams: `query standby_teams($u: ID!) { atlassianUserInTeams(userId: $u, first: 5) { edges { node { ... on AtlassianTeam { id displayName } } } } }`,
  members: `query standby_members($t: ID!) { atlassianTeamMembers(teamAri: $t, first: 25) { edges { node { ${U} } } } }`,
  assigned: `query standby_assigned($u: ID!) { atlassianUserAssignedJiraWorkItems(userId: $u, first: 25) { edges { node { ... on JiraWorkItem { key summary webUrl dueAt status { name statusCategory { key } } reporter { ${U} } } } } } }`,
  content: `query standby_content($u: ID!) { atlassianUserContent(userId: $u, roles: [CREATED], since: "P365D", first: 25) { edges { node { __typename ... on ConfluencePage { pageId title webUrl lastUpdatedAt space { key name } owner { ${U} } lastEditor { ${U} } } } } } }`,
  owns: `query standby_owns($u: ID!) { atlassianUserGoalsAndProjects(userId: $u, roles: [OWNS], first: 25) { edges { node { __typename ... on AtlassianProject { id key name url state dueDateEndedAt } ... on AtlassianGoal { id key name url dueDateEndedAt } } } } }`,
};

const nodes = (data: Json, field: string): Json[] => (data?.[field]?.edges ?? []).map((e: Json) => e.node).filter(Boolean);

const graphPerson = (u: Json): Person | undefined => (u?.accountId && u?.name ? toPerson({ accountId: u.accountId, displayName: u.name }) : undefined);

export function parseAssigned(data: Json, outId: string): WorkItem[] {
  return nodes(data, 'atlassianUserAssignedJiraWorkItems')
    .filter((n) => n.key && !/done/i.test(n.status?.statusCategory?.key ?? ''))
    .map((n): WorkItem => {
      const reporter = graphPerson(n.reporter);
      const touchedBy: Touch[] = reporter && reporter.accountId !== outId ? [{ ...reporter, how: `reported ${n.key}` }] : [];
      const item: WorkItem = { id: `jira:${n.key}`, kind: 'issue', key: n.key, title: n.summary ?? n.key, url: n.webUrl, roles: ['assignee'], sources: ['graph'], touchedBy };
      if (n.dueAt) item.dueAt = n.dueAt;
      if (n.status?.name) item.status = n.status.name;
      return item;
    });
}

export function parseContent(data: Json, outId: string): WorkItem[] {
  return nodes(data, 'atlassianUserContent')
    .filter((n) => n.__typename === 'ConfluencePage' && n.pageId)
    .map((n): WorkItem => {
      const touchedBy: Touch[] = [];
      for (const [u, how] of [[n.owner, 'owns'], [n.lastEditor, 'last edited']] as const) {
        const p = graphPerson(u);
        if (p && p.accountId !== outId && !touchedBy.some((t) => t.accountId === p.accountId)) touchedBy.push({ ...p, how: `${how} "${n.title}"` });
      }
      const item: WorkItem = { id: `conf:${n.pageId}`, kind: 'page', title: n.title, url: n.webUrl, roles: ['page creator'], sources: ['graph'], touchedBy };
      if (n.space?.key) item.container = { id: `conf:${n.space.key}`, name: n.space.name ?? n.space.key };
      if (n.lastUpdatedAt) item.updatedAt = n.lastUpdatedAt;
      return item;
    });
}

export function parseOwns(data: Json): WorkItem[] {
  return nodes(data, 'atlassianUserGoalsAndProjects')
    .filter((n) => n.name && n.state !== 'DONE' && n.state !== 'ARCHIVED')
    .map((n): WorkItem => {
      const goal = n.__typename === 'AtlassianGoal';
      const item: WorkItem = {
        id: `${goal ? 'goal' : 'atlas'}:${n.id}`,
        kind: goal ? 'goal' : 'atlas-project',
        key: n.key,
        title: n.name,
        url: n.url,
        roles: [goal ? 'goal owner' : 'project owner'],
        sources: ['graph'],
        touchedBy: [],
      };
      if (n.dueDateEndedAt) item.dueAt = n.dueDateEndedAt;
      return item;
    });
}

async function run(graph: Graph, query: string, vars: Record<string, unknown>): Promise<Json> {
  const res = await graph(query, vars);
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
  return res.data ?? {};
}

/** Each query is independent: one failing (a missing scope, a preview change) must not hide the others. */
export async function graphSignals(graph: Graph, outId: string) {
  const u = user(outId);
  const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: Error) => ({ ok: false as const, e: e.message }));
  const [teams, assigned, content, owns] = await Promise.all([
    settle(run(graph, QUERIES.teams, { u })),
    settle(run(graph, QUERIES.assigned, { u })),
    settle(run(graph, QUERIES.content, { u })),
    settle(run(graph, QUERIES.owns, { u })),
  ]);
  const teamNodes = teams.ok ? nodes(teams.v, 'atlassianUserInTeams') : [];
  const memberLists = await Promise.all(teamNodes.slice(0, 3).map((t) => settle(run(graph, QUERIES.members, { t: t.id }))));
  const teammates: { person: Person; team: string }[] = [];
  memberLists.forEach((m, i) => {
    if (!m.ok) return;
    for (const n of nodes(m.v, 'atlassianTeamMembers')) {
      const p = graphPerson(n);
      if (p && p.accountId !== outId && !teammates.some((t) => t.person.accountId === p.accountId)) teammates.push({ person: p, team: teamNodes[i].displayName });
    }
  });
  const items = [
    ...(assigned.ok ? parseAssigned(assigned.v, outId) : []),
    ...(content.ok ? parseContent(content.v, outId) : []),
    ...(owns.ok ? parseOwns(owns.v) : []),
  ];
  const errors = [teams, assigned, content, owns].filter((r) => !r.ok).map((r) => (r.ok ? '' : r.e));
  return { items, teammates, teams: teamNodes.map((t) => t.displayName as string), errors };
}
