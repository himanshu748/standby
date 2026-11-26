import type { Person, Touch, WorkItem } from '../core/model';
import { getJson, q, type Json, type Rest } from './http';
import { toPerson } from './people';

export const FIELDS = 'summary,status,priority,duedate,project,reporter,updated,comment';

export function parseIssues(json: Json, siteUrl: string, outId: string): WorkItem[] {
  return (json.issues ?? []).map((issue: Json): WorkItem => {
    const f = issue.fields ?? {};
    const touched = new Map<string, Touch>();
    const touch = (u: Json, how: string) => {
      const p = toPerson(u);
      if (p && p.accountId !== outId && !touched.has(p.accountId)) touched.set(p.accountId, { ...p, how });
    };
    for (const h of issue.changelog?.histories ?? []) touch(h.author, `updated ${issue.key}`);
    for (const c of f.comment?.comments ?? []) touch(c.author, `commented on ${issue.key}`);
    touch(f.reporter, `reported ${issue.key}`);
    const item: WorkItem = {
      id: `jira:${issue.key}`,
      kind: 'issue',
      key: issue.key,
      title: f.summary ?? issue.key,
      url: `${siteUrl}/browse/${issue.key}`,
      roles: ['assignee'],
      sources: ['jira'],
      touchedBy: [...touched.values()],
    };
    if (f.project) item.container = { id: `jira:${f.project.key}`, name: f.project.name };
    if (f.status?.name) item.status = f.status.name;
    if (f.priority?.name) item.priority = f.priority.name;
    if (f.duedate) item.dueAt = f.duedate;
    if (f.updated) item.updatedAt = f.updated;
    return item;
  });
}

export function parseLeads(json: Json, siteUrl: string, outId: string): WorkItem[] {
  return (json.values ?? [])
    .filter((p: Json) => p.lead?.accountId === outId)
    .map((p: Json): WorkItem => ({
      id: `jira-project:${p.key}`,
      kind: 'project-lead',
      key: p.key,
      title: `${p.name} project`,
      url: `${siteUrl}/jira/software/projects/${p.key}`,
      container: { id: `jira:${p.key}`, name: p.name },
      roles: ['project lead'],
      sources: ['jira'],
      touchedBy: [],
    }));
}

/** Everyone else with open work in the given projects: they already know the project and its people. */
export function parsePeers(json: Json): Record<string, { person: Person; note: string }[]> {
  const counts = new Map<string, Map<string, { person: Person; n: number; name: string }>>();
  for (const issue of json.issues ?? []) {
    const p = toPerson(issue.fields?.assignee);
    const project = issue.fields?.project;
    if (!p || !project) continue;
    const id = `jira:${project.key}`;
    const byPerson = counts.get(id) ?? new Map();
    const entry = byPerson.get(p.accountId) ?? { person: p, n: 0, name: project.name };
    entry.n += 1;
    byPerson.set(p.accountId, entry);
    counts.set(id, byPerson);
  }
  const out: Record<string, { person: Person; note: string }[]> = {};
  for (const [id, byPerson] of counts) {
    out[id] = [...byPerson.values()].sort((a, b) => b.n - a.n).map((e) => ({ person: e.person, note: `${e.n} open in ${e.name}` }));
  }
  return out;
}

export async function searchUsers(rest: Rest, query: string): Promise<Person[]> {
  const json = await getJson(rest, `/rest/api/3/user/search?${q({ query, maxResults: 20 })}`);
  return (json as Json[]).map(toPerson).filter((p): p is Person => !!p);
}

export async function jiraSignals(rest: Rest, siteUrl: string, outId: string) {
  const jql = `assignee = "${outId.replace(/"/g, '')}" AND statusCategory != Done ORDER BY duedate ASC, priority DESC`;
  const [issuesJson, projectsJson] = await Promise.all([
    getJson(rest, `/rest/api/3/search/jql?${q({ jql, fields: FIELDS, expand: 'changelog', maxResults: 50 })}`),
    getJson(rest, `/rest/api/3/project/search?${q({ expand: 'lead', maxResults: 100 })}`),
  ]);
  const items = [...parseIssues(issuesJson, siteUrl, outId), ...parseLeads(projectsJson, siteUrl, outId)];
  const keys = [...new Set(items.map((i) => i.container?.id.slice(5)).filter(Boolean))];
  const peersJql = `project in (${keys.map((k) => `"${k}"`).join(',')}) AND statusCategory != Done AND assignee is not EMPTY`;
  const peersJson = keys.length
    ? await getJson(rest, `/rest/api/3/search/jql?${q({ jql: peersJql, fields: 'assignee,project', maxResults: 100 })}`).catch(() => null)
    : { issues: [] };
  return {
    items,
    peers: peersJson === null ? {} : parsePeers(peersJson),
    peerLookupFailed: peersJson === null,
    issueCount: (issuesJson.issues ?? []).length,
    more: !!issuesJson.nextPageToken,
  };
}

export async function reassign(rest: Rest, issueKey: string, accountId: string): Promise<void> {
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(issueKey)) throw new Error('Not an issue key');
  const res = await rest(`/rest/api/3/issue/${issueKey}/assignee`, { method: 'PUT', body: JSON.stringify({ accountId }) });
  if (!res.ok) throw new Error(`Jira refused to reassign ${issueKey} (${res.status})`);
}
