import type { Graph, Json, Res, Rest } from '../adapters/http';

/** A checkout team small enough to read and large enough to show every coverage ring. */
export type Seed = {
  site: string;
  window: { from: string; to: string };
  out: string;
  handoverSpaceId: string;
  team: { id: string; name: string };
  teamMemberIds: string[];
  people: { accountId: string; name: string }[];
  project: { key: string; name: string; leadId: string };
  space: { key: string; name: string };
  issues: {
    key: string;
    summary: string;
    status: string;
    statusCategory: string;
    priority: string;
    due: string;
    assigneeId: string;
    reporterId: string;
    commentBy: string[];
    updatedBy: string[];
  }[];
  peerIssues: { key: string; assigneeId: string }[];
  pages: { id: string; title: string; ownerId: string; creatorId: string; updatedAt: string; authorIds: string[] }[];
  owns: { type: 'goal' | 'project'; id: string; key: string; name: string; due: string; state?: string }[];
  /** Work ids that sit in a colleague's Teamwork Graph, whether or not Jira history names them. */
  graphHolds: Record<string, string[]>;
};

export type Call = { product: 'jira' | 'confluence' | 'graph'; method: string; path: string; body?: string };

const DRAFT_ID = '91002';

const ok = (body: unknown): Res => ({ ok: true, status: 200, json: async () => body });

export function clientsFromSeed(seed: Seed): { jira: Rest; conf: Rest; graph: Graph; calls: Call[] } {
  const calls: Call[] = [];
  const named = (id: string) => {
    const person = seed.people.find((p) => p.accountId === id);
    if (!person) throw new Error(`seed has no person ${id}`);
    return person;
  };
  const jiraUser = (id: string) => ({ accountId: id, displayName: named(id).name, accountType: 'atlassian', active: true });
  const note = (product: Call['product'], method: string, path: string, body?: string) => {
    const call: Call = { product, method, path };
    if (body !== undefined) call.body = body;
    calls.push(call);
  };

  const issue = (spec: Seed['issues'][number]) => ({
    key: spec.key,
    fields: {
      summary: spec.summary,
      status: { name: spec.status, statusCategory: { key: spec.statusCategory } },
      priority: { name: spec.priority },
      duedate: spec.due,
      updated: '2026-11-28T12:00:00.000Z',
      project: { key: seed.project.key, name: seed.project.name },
      reporter: jiraUser(spec.reporterId),
      comment: { comments: spec.commentBy.map((id) => ({ author: jiraUser(id) })) },
    },
    changelog: { histories: spec.updatedBy.map((id) => ({ author: jiraUser(id) })) },
  });

  const jira: Rest = async (path, init) => {
    const method = init?.method ?? 'GET';
    note('jira', method, path, init?.body);
    if (method === 'PUT' && seed.issues.some((spec) => path === `/rest/api/3/issue/${spec.key}/assignee`)) {
      const { accountId } = JSON.parse(init?.body ?? '{}') as { accountId?: string };
      if (seed.people.some((p) => p.accountId === accountId)) return ok({});
    }
    if (path.startsWith('/rest/api/3/user/bulk')) return ok({ values: seed.people.map((p) => jiraUser(p.accountId)) });
    if (path.startsWith('/rest/api/3/project/search')) {
      return ok({ values: [{ key: seed.project.key, name: seed.project.name, lead: jiraUser(seed.project.leadId) }] });
    }
    if (path.startsWith('/rest/api/3/search/jql')) {
      if (path.includes('assignee%20is%20not%20EMPTY')) {
        const assigned = seed.issues.map((spec) => ({ key: spec.key, fields: { assignee: jiraUser(spec.assigneeId), project: { key: seed.project.key, name: seed.project.name } } }));
        const peers = seed.peerIssues.map((spec) => ({ key: spec.key, fields: { assignee: jiraUser(spec.assigneeId), project: { key: seed.project.key, name: seed.project.name } } }));
        return ok({ issues: [...assigned, ...peers] });
      }
      return ok({ issues: seed.issues.map(issue) });
    }
    return { ok: false, status: 404, json: async () => ({ error: path }) };
  };

  const conf: Rest = async (path, init) => {
    const method = init?.method ?? 'GET';
    note('confluence', method, path, init?.body);
    if (path.startsWith('/wiki/api/v2/spaces?')) return ok({ results: [{ ...seed.space, id: seed.handoverSpaceId }] });
    if (method === 'POST' && path === '/wiki/api/v2/pages') {
      return ok({ id: DRAFT_ID, _links: { base: `${seed.site}/wiki`, editui: `/pages/resumedraft.action?draftId=${DRAFT_ID}` } });
    }
    if (path.includes('/versions')) {
      const id = path.split('/pages/')[1]?.split('/')[0];
      const page = seed.pages.find((p) => p.id === id);
      return ok({ results: (page?.authorIds ?? []).map((authorId) => ({ authorId })) });
    }
    if (path.startsWith('/wiki/api/v2/pages')) return ok({ results: seed.pages.map((p) => ({ id: p.id, ownerId: p.ownerId })) });
    if (path.startsWith('/wiki/rest/api/search')) {
      return ok({
        results: seed.pages.map((p) => ({
          content: {
            id: p.id,
            type: 'page',
            title: p.title,
            space: seed.space,
            _links: { webui: `/spaces/${seed.space.key}/pages/${p.id}` },
            version: { when: p.updatedAt },
            history: { createdBy: { accountId: p.creatorId } },
          },
        })),
      });
    }
    return { ok: false, status: 404, json: async () => ({ error: path }) };
  };

  const edge = (node: Json) => ({ node });
  const workNode = (id: string): Json =>
    id.startsWith('conf:')
      ? { __typename: 'ConfluencePage', pageId: id.slice(5), title: id, owner: { accountId: seed.out, name: named(seed.out).name } }
      : { __typename: 'JiraWorkItem', key: id.slice(5), summary: id, status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } };

  const priyaWork = (): Json[] => [
    ...seed.issues.map((spec) =>
      edge({
        __typename: 'JiraWorkItem',
        key: spec.key,
        summary: spec.summary,
        webUrl: `${seed.site}/browse/${spec.key}`,
        dueAt: spec.due,
        status: { name: spec.status, statusCategory: { key: spec.statusCategory } },
        assignee: { accountId: spec.assigneeId, name: named(spec.assigneeId).name },
        reporter: { accountId: spec.reporterId, name: named(spec.reporterId).name },
      }),
    ),
    ...seed.pages.map((p) => {
      const editor = p.authorIds[0] ?? p.ownerId;
      return edge({
        __typename: 'ConfluencePage',
        pageId: p.id,
        title: p.title,
        webUrl: `${seed.site}/wiki/spaces/${seed.space.key}/pages/${p.id}`,
        lastUpdatedAt: p.updatedAt,
        space: seed.space,
        owner: { accountId: p.ownerId, name: named(p.ownerId).name },
        lastEditor: { accountId: editor, name: named(editor).name },
      });
    }),
  ];

  const graphClient: Graph = async (query, variables) => {
    note('graph', 'POST', query.slice(0, 48));
    const accountId = String(variables['u'] ?? '').split('/').pop() ?? '';
    const data = (field: string, edges: Json[]) => ({ [field]: { edges } });
    if (query.includes('standby_teams')) return { data: data('atlassianUserInTeams', [edge({ id: seed.team.id, displayName: seed.team.name })]) };
    if (query.includes('standby_members')) {
      return { data: data('atlassianTeamMembers', seed.teamMemberIds.map((id) => edge({ accountId: id, name: named(id).name }))) };
    }
    if (query.includes('standby_assigned')) {
      return {
        data: data(
          'atlassianUserAssignedJiraWorkItems',
          seed.issues.map((spec) =>
            edge({
              key: spec.key,
              summary: spec.summary,
              webUrl: `${seed.site}/browse/${spec.key}`,
              dueAt: spec.due,
              status: { name: spec.status, statusCategory: { key: spec.statusCategory } },
              reporter: { accountId: spec.reporterId, name: named(spec.reporterId).name },
            }),
          ),
        ),
      };
    }
    if (query.includes('standby_owns')) {
      return {
        data: data(
          'atlassianUserGoalsAndProjects',
          seed.owns.map((own) => {
            const node: Json = {
              __typename: own.type === 'goal' ? 'AtlassianGoal' : 'AtlassianProject',
              id: own.id,
              key: own.key,
              name: own.name,
              url: `${seed.site}/jira/${own.type === 'goal' ? 'goals' : 'projects'}/${own.key}`,
              dueDateEndedAt: own.due,
            };
            if (own.state) node.state = own.state;
            return edge(node);
          }),
        ),
      };
    }
    if (query.includes('standby_work')) {
      const edges = accountId === seed.out ? priyaWork() : (seed.graphHolds[accountId] ?? []).map((id) => edge(workNode(id)));
      return { data: { atlassianUserWorkQuery: { pageInfo: { hasNextPage: false }, edges } } };
    }
    return { errors: [{ message: `seed has no graph query ${query.slice(0, 40)}` }] };
  };

  return { jira, conf, graph: graphClient, calls };
}
