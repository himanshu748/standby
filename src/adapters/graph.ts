import type { Person, Touch, WorkItem } from "../core/model";
import type { Graph, Json } from "./http";
import { toPerson } from "./people";
import { mergeItems as mergeLinked } from "../core/drill";

const user = (accountId: string) => `ari:cloud:identity::user/${accountId}`;
const U = "... on AtlassianUser { accountId name }";

export const QUERIES = {
  teams: `query standby_teams($u: ID!) { atlassianUserInTeams(userId: $u, first: 5) { edges { node { ... on AtlassianTeam { id displayName } } } } }`,
  members: `query standby_members($t: ID!) { atlassianTeamMembers(teamAri: $t, first: 25) { edges { node { ${U} } } } }`,
  assigned: `query standby_assigned($u: ID!) { atlassianUserAssignedJiraWorkItems(userId: $u, first: 25) { edges { node { ... on JiraWorkItem { key summary webUrl dueAt status { name statusCategory { key } } reporter { ${U} } } } } } }`,
  work: `query standby_work($u: ID!, $after: String) { atlassianUserWorkQuery(userId: $u, first: 25, after: $after) { pageInfo { hasNextPage endCursor } edges { node { __typename ... on ConfluencePage { pageId title webUrl lastUpdatedAt space { key name } owner { ${U} } lastEditor { ${U} } } ... on ConfluenceBlogPost { id title lastUpdatedAt space { key name } owner { ${U} } lastEditor { ${U} } } ... on JiraWorkItem { key summary webUrl dueAt status { name statusCategory { key } } assignee { ${U} } reporter { ${U} } } } } } }`,
  owns: `query standby_owns($u: ID!) { atlassianUserGoalsAndProjects(userId: $u, roles: [OWNS], first: 25) { edges { node { __typename ... on AtlassianProject { id key name url state dueDateEndedAt } ... on AtlassianGoal { id key name url dueDateEndedAt } } } } }`,
};

const nodes = (data: Json, field: string): Json[] =>
  (data?.[field]?.edges ?? []).map((e: Json) => e?.node).filter(Boolean);

const done = (n: Json) => /done/i.test(n.status?.statusCategory?.key ?? "");
const tail = (ari: string | undefined) => ari?.split("/").pop();

/** The id an object from atlassianUserWorkQuery gets in the merged model, so Graph, Jira and Confluence copies line up. */
export function workId(n: Json): string | undefined {
  if (n.__typename === "JiraWorkItem" && n.key) return `jira:${n.key}`;
  if (n.__typename === "ConfluencePage" && n.pageId) return `conf:${n.pageId}`;
  if (n.__typename === "ConfluenceBlogPost" && tail(n.id))
    return `conf:${tail(n.id)}`;
  return undefined;
}

const graphPerson = (u: Json): Person | undefined =>
  u?.accountId && u?.name
    ? toPerson({ accountId: u.accountId, displayName: u.name })
    : undefined;

export function parseAssigned(data: Json, outId: string): WorkItem[] {
  return nodes(data, "atlassianUserAssignedJiraWorkItems")
    .filter((n) => n.key && !done(n))
    .map((n): WorkItem => {
      const reporter = graphPerson(n.reporter);
      const touchedBy: Touch[] =
        reporter && reporter.accountId !== outId
          ? [{ ...reporter, how: `reported ${n.key}` }]
          : [];
      const item: WorkItem = {
        id: `jira:${n.key}`,
        kind: "issue",
        key: n.key,
        title: n.summary ?? n.key,
        url: n.webUrl,
        roles: ["assignee"],
        sources: ["graph"],
        touchedBy,
      };
      if (n.dueAt) item.dueAt = n.dueAt;
      if (n.status?.name) item.status = n.status.name;
      return item;
    });
}

/** Everything Teamwork Graph links to the person: pages and posts they created, edit, watch or are mentioned in, and Jira work. */
export function parseWork(data: Json, outId: string, siteUrl = ""): WorkItem[] {
  const out: WorkItem[] = [];
  for (const n of nodes(data, "atlassianUserWorkQuery")) {
    const id = workId(n);
    if (!id || out.some((i) => i.id === id)) continue;
    const issue = n.__typename === "JiraWorkItem";
    if (issue && done(n)) continue;
    const title = (issue ? n.summary : n.title) ?? n.key ?? "Untitled";
    const touchedBy: Touch[] = [];
    const pairs = issue
      ? ([
          [n.assignee, "is assigned"],
          [n.reporter, "reported"],
        ] as const)
      : ([
          [n.owner, "owns"],
          [n.lastEditor, "last edited"],
        ] as const);
    for (const [u, how] of pairs) {
      const p = graphPerson(u);
      if (
        p &&
        p.accountId !== outId &&
        !touchedBy.some((t) => t.accountId === p.accountId)
      )
        touchedBy.push({ ...p, how: `${how} ${issue ? n.key : `"${title}"`}` });
    }
    // A page they only watch or were mentioned on is context, not their work: keep pages they own or last edited.
    const mine = [
      ...(n.assignee?.accountId === outId ? ["assignee"] : []),
      ...(n.reporter?.accountId === outId ? ["reporter"] : []),
    ];
    const roles = issue
      ? mine.length
        ? mine
        : ["linked issue"]
      : [
          ...(n.owner?.accountId === outId ? ["page owner"] : []),
          ...(n.lastEditor?.accountId === outId ? ["last editor"] : []),
        ];
    if (!roles.length) continue;
    const item: WorkItem = {
      id,
      kind: issue ? "issue" : "page",
      title,
      url:
        n.webUrl ??
        (siteUrl &&
          (issue
            ? `${siteUrl}/browse/${n.key}`
            : `${siteUrl}/wiki/pages/viewpage.action?pageId=${id.slice(5)}`)),
      roles,
      sources: ["graph"],
      touchedBy,
    };
    if (issue) item.key = n.key;
    if (n.space?.key)
      item.container = {
        id: `conf:${n.space.key}`,
        name: n.space.name ?? n.space.key,
      };
    if (n.dueAt) item.dueAt = n.dueAt;
    if (n.status?.name) item.status = n.status.name;
    if (n.lastUpdatedAt) item.updatedAt = n.lastUpdatedAt;
    out.push(item);
  }
  return out;
}

export function parseOwns(data: Json): WorkItem[] {
  return nodes(data, "atlassianUserGoalsAndProjects")
    .filter((n) => n.name && n.state !== "DONE" && n.state !== "ARCHIVED")
    .map((n): WorkItem => {
      const goal = n.__typename === "AtlassianGoal";
      const item: WorkItem = {
        id: `${goal ? "goal" : "atlas"}:${n.id}`,
        kind: goal ? "goal" : "atlas-project",
        key: n.key,
        title: n.name,
        url: n.url,
        roles: [goal ? "goal owner" : "project owner"],
        sources: ["graph"],
        touchedBy: [],
      };
      if (n.dueDateEndedAt) item.dueAt = n.dueDateEndedAt;
      return item;
    });
}

async function run(
  graph: Graph,
  query: string,
  vars: Record<string, unknown>,
  warnings: string[],
): Promise<Json> {
  const res = await graph(query, vars);
  const errors = res.errors?.map((e) => e.message) ?? [];
  // Keep usable data, but report any missing part of the response.
  if (errors.length && !res.data) throw new Error(errors.join("; "));
  warnings.push(...errors);
  return res.data ?? {};
}

/** Pages through atlassianUserWorkQuery, merging every page into one connection. */
async function workOf(graph: Graph, u: string, pages: number, warnings: string[]): Promise<Json> {
  const edges: Json[] = [];
  let after: string | undefined;
  for (let i = 0; i < pages; i++) {
    let conn: Json;
    try {
      conn = (await run(graph, QUERIES.work, after ? { u, after } : { u }, warnings)).atlassianUserWorkQuery;
    } catch (error) {
      if (i === 0) throw error;
      warnings.push(`Teamwork Graph work pagination stopped: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    edges.push(...(conn?.edges ?? []));
    if (!conn?.pageInfo?.hasNextPage) break;
    const next = conn.pageInfo.endCursor;
    if (typeof next !== "string" || !next || next === after) {
      warnings.push("Teamwork Graph work pagination did not advance");
      break;
    }
    if (i + 1 === pages) warnings.push("Teamwork Graph work reached its page limit");
    after = next;
  }
  return { atlassianUserWorkQuery: { edges } };
}

/** Adds a touch for every candidate whose own Teamwork Graph neighbourhood contains the item. */
export function coLinks(
  items: WorkItem[],
  neighbourhoods: { person: Person; ids: Set<string> }[],
): { items: WorkItem[]; links: number } {
  let links = 0;
  const next = items.map((item) => {
    const extra: Touch[] = [];
    for (const { person, ids } of neighbourhoods) {
      if (
        !ids.has(item.id) ||
        item.touchedBy.some((t) => t.accountId === person.accountId)
      )
        continue;
      extra.push({ ...person, how: "works on it too, per Teamwork Graph" });
      links++;
    }
    return extra.length
      ? { ...item, touchedBy: [...item.touchedBy, ...extra] }
      : item;
  });
  return { items: next, links };
}

/** Second pass: whose Teamwork Graph work overlaps the person's, turning shared objects into coverage. */
export async function graphCoverage(
  graph: Graph,
  items: WorkItem[],
  candidates: Person[],
) {
  const results = await Promise.allSettled(
    candidates.map(async (p) => {
      const warnings: string[] = [];
      const data = await workOf(graph, user(p.accountId), 2, warnings);
      return { data, partial: warnings.length > 0 };
    }),
  );
  const neighbourhoods = results.flatMap((r, i) =>
    r.status === "fulfilled"
      ? [
          {
            person: candidates[i]!,
            ids: new Set(
              nodes(r.value.data, "atlassianUserWorkQuery")
                .map(workId)
                .filter((x): x is string => !!x),
            ),
          },
        ]
      : [],
  );
  const partial = results.filter((r) => r.status === "fulfilled" && r.value.partial).length;
  return { ...coLinks(items, neighbourhoods), checked: neighbourhoods.length, partial };
}

/** Each query is independent: one failing (a missing scope, a preview change) must not hide the others. */
export async function graphSignals(graph: Graph, outId: string, siteUrl = "") {
  const u = user(outId);
  const warnings: string[] = [];
  const settle = <T>(p: Promise<T>) =>
    p.then(
      (v) => ({ ok: true as const, v }),
      (e: Error) => ({ ok: false as const, e: e.message }),
    );
  const [teams, assigned, work, owns] = await Promise.all([
    settle(run(graph, QUERIES.teams, { u }, warnings)),
    settle(run(graph, QUERIES.assigned, { u }, warnings)),
    settle(workOf(graph, u, 4, warnings)),
    settle(run(graph, QUERIES.owns, { u }, warnings)),
  ]);
  const teamNodes = teams.ok ? nodes(teams.v, "atlassianUserInTeams") : [];
  const teamsToRead = teamNodes.slice(0, 3);
  if (teamsToRead.length < teamNodes.length) {
    warnings.push(`Teamwork Graph member lookups limited to ${teamsToRead.length} of ${teamNodes.length} teams`);
  }
  const memberLists = await Promise.all(
    teamsToRead.map((t) => settle(run(graph, QUERIES.members, { t: t.id }, warnings))),
  );
  const teammates: { person: Person; team: string }[] = [];
  memberLists.forEach((m, i) => {
    if (!m.ok) return;
    for (const n of nodes(m.v, "atlassianTeamMembers")) {
      const p = graphPerson(n);
      if (
        p &&
        p.accountId !== outId &&
        !teammates.some((t) => t.person.accountId === p.accountId)
      )
        teammates.push({ person: p, team: teamsToRead[i].displayName });
    }
  });
  const linked = mergeLinked([
    ...(assigned.ok ? parseAssigned(assigned.v, outId) : []),
    ...(work.ok ? parseWork(work.v, outId, siteUrl) : []),
  ]);
  const owned = owns.ok ? parseOwns(owns.v) : [];
  const items = [...linked, ...owned];
  const neighbourhood = new Set(
    work.ok
      ? nodes(work.v, "atlassianUserWorkQuery")
          .map(workId)
          .filter((x): x is string => !!x)
      : [],
  );
  const failures = [teams, assigned, work, owns, ...memberLists]
    .flatMap((r) => (r.ok ? [] : [r.e]));
  const errors = [...new Set([...failures, ...warnings])].sort();
  return {
    items,
    neighbourhood,
    teammates,
    teams: teamNodes.map((t) => t.displayName as string),
    errors,
    counts: {
      work: linked.filter((i) => i.kind === "issue").length,
      pages: linked.filter((i) => i.kind === "page").length,
      owned: owned.length,
    },
  };
}
