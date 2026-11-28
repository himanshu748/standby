import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { product: 'jira' | 'confluence'; path: string; method: string; body?: string | undefined };
type Reply = { status: number; body?: unknown };
const calls: Call[] = [];
let route: (c: Call) => Reply;
let graphFails = false;
let graphStatus = 200;

const res = ({ status, body }: Reply) => ({ ok: status < 300, status, json: async () => body ?? {} });

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => ({
      requestJira: async (path: string, init?: { method?: string; body?: string }) => {
        const c: Call = { product: 'jira', path, method: init?.method ?? 'GET', body: init?.body };
        calls.push(c);
        return res(route(c));
      },
      requestConfluence: async (path: string, init?: { method?: string; body?: string }) => {
        const c: Call = { product: 'confluence', path, method: init?.method ?? 'GET', body: init?.body };
        calls.push(c);
        return res(route(c));
      },
      requestTeamworkGraph: async () => {
        if (graphFails) throw new Error('Teamwork Graph unavailable');
        return res({ status: graphStatus, body: graphStatus === 200 ? { data: {} } : { message: 'Graph gateway rejected the request' } });
      },
    }),
  },
  assumeTrustedRoute: (p: string) => p,
}));

const handlers: Record<string, (r: { payload: Record<string, unknown>; context?: Record<string, unknown> }) => Promise<unknown>> = {};
vi.mock('@forge/resolver', () => ({
  default: class {
    define(name: string, fn: (typeof handlers)[string]) {
      handlers[name] = fn;
    }
    getDefinitions() {
      return handlers;
    }
  },
}));

const { drill } = await import('../src/index');
const { issueCover } = await import('../src/service');

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const SITE = 'https://one-atlas-obka.atlassian.net';
const ALANA = '60ad2d2a06bf0c006a42fa84';
const input = { accountId: ALANA, from: '2026-12-01', to: '2026-12-12', siteUrl: SITE };

function jiraOnly(c: Call): Reply {
  if (c.product === 'confluence') return { status: 503 };
  if (c.path.startsWith('/rest/api/3/user/bulk')) return { status: 200, body: { values: [{ accountId: ALANA, accountType: 'atlassian', displayName: 'Alana Grant' }] } };
  if (c.path.startsWith('/rest/api/3/project/search')) return { status: 200, body: fx('projects') };
  if (c.path.startsWith('/rest/api/3/search/jql')) return { status: 200, body: c.path.includes('assignee%20is%20not%20EMPTY') ? { issues: [] } : fx('jira-assigned') };
  return { status: 404 };
}

beforeEach(() => {
  calls.length = 0;
  route = jiraOnly;
  graphFails = false;
  graphStatus = 200;
});

describe('drill input', () => {
  it.each([
    [{ ...input, accountId: '' }, 'Pick a person first'],
    [{ ...input, from: '2026-12-12', to: '2026-12-01' }, 'Pick a valid absence window'],
    [{ ...input, from: '2026-11-31' }, 'Pick a valid absence window'],
    [{ ...input, to: '2026-13-01' }, 'Pick a valid absence window'],
    [{ ...input, siteUrl: 'https://evil.example.com' }, 'Unknown site'],
  ])('rejects %j before calling any product', async (p, message) => {
    await expect(drill(p)).rejects.toThrow(message);
    expect(calls).toHaveLength(0);
  });

  it('refuses a person who is not an active user', async () => {
    route = (c) => (c.path.startsWith('/rest/api/3/user/bulk') ? { status: 200, body: { values: [] } } : jiraOnly(c));
    await expect(drill(input)).rejects.toThrow('not an active user');
  });
});

describe('drill sources', () => {
  it('keeps the Jira results and reports each failed source when Confluence and Teamwork Graph are down', async () => {
    graphFails = true;
    const d = await drill(input);
    const by = Object.fromEntries(d.sources.map((s) => [s.source, s]));
    expect(by['jira']).toMatchObject({ ok: true });
    expect(by['confluence']).toMatchObject({ ok: false, count: 0 });
    expect(by['confluence']!.note).toContain('503');
    expect(by['graph']!.ok).toBe(false);
    expect(by['graph']!.note).toContain('Teamwork Graph unavailable');
    expect(d.items.length).toBeGreaterThan(0);
    expect(d.items.every((i) => !i.sources.includes('confluence'))).toBe(true);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it.each([403, 429])('keeps Jira results when the Teamwork Graph gateway returns HTTP %s', async (status) => {
    graphStatus = status;
    const result = await drill(input);

    expect(result.items.some((item) => item.id === 'jira:MS-1')).toBe(true);
    expect(result.sources.find((source) => source.source === 'jira')).toMatchObject({ ok: true });
    expect(result.sources.find((source) => source.source === 'graph')).toMatchObject({
      ok: false,
      count: 0,
      note: expect.stringContaining(`Teamwork Graph returned HTTP ${status}`),
    });
  });

  it('keeps confirmed Jira work when the project colleague lookup fails', async () => {
    route = (c) => c.path.includes('assignee%20is%20not%20EMPTY') ? { status: 503 } : jiraOnly(c);
    const d = await drill(input);
    expect(d.items.some((i) => i.id === 'jira:MS-1')).toBe(true);
    expect(d.sources.find((s) => s.source === 'jira')).toMatchObject({
      ok: false,
      count: expect.any(Number),
      note: expect.stringContaining('project colleague lookup unavailable'),
    });
  });

  it('keeps assigned issues when the project lead lookup is refused', async () => {
    route = (c) => c.path.startsWith('/rest/api/3/project/search') ? { status: 403 } : jiraOnly(c);
    const d = await drill(input);
    expect(d.items.some((i) => i.id === 'jira:MS-1')).toBe(true);
    expect(d.sources.find((s) => s.source === 'jira')).toMatchObject({
      ok: false,
      note: expect.stringContaining('project lead lookup unavailable'),
    });
  });

  it('keeps project leads when assigned issues cannot be read', async () => {
    route = (c) => c.path.startsWith('/rest/api/3/search/jql') && !c.path.includes('assignee%20is%20not%20EMPTY')
      ? { status: 403 }
      : jiraOnly(c);
    const d = await drill(input);
    expect(d.items.some((i) => i.kind === 'project-lead')).toBe(true);
    const jira = d.sources.find((s) => s.source === 'jira');
    expect(jira).toMatchObject({
      ok: false,
      note: expect.stringContaining('assigned issue lookup unavailable'),
    });
    expect(jira?.note).not.toContain('0 open issues assigned');
  });

  it('retains results and reports Jira pagination limits as partial coverage', async () => {
    route = (c) => {
      if (c.path.startsWith('/rest/api/3/project/search')) return { status: 200, body: { ...fx('projects'), isLast: false } };
      if (c.path.includes('assignee%20is%20not%20EMPTY')) return { status: 200, body: { issues: [], isLast: false } };
      if (c.path.startsWith('/rest/api/3/search/jql')) return { status: 200, body: { ...fx('jira-assigned'), nextPageToken: 'more' } };
      return jiraOnly(c);
    };
    const d = await drill(input);
    expect(d.items.some((i) => i.id === 'jira:MS-1')).toBe(true);
    const jira = d.sources.find((s) => s.source === 'jira');
    expect(jira).toMatchObject({
      ok: false,
      note: expect.stringContaining('additional projects were not read'),
    });
    expect(jira?.note).toContain('additional colleague results were not read');
  });

  it.each(['changelog', 'comments'])('marks Jira coverage partial with truncated %s', async (kind) => {
    const issue = fx('jira-assigned').issues[0];
    if (kind === 'changelog') issue.changelog.total = issue.changelog.histories.length + 1;
    else issue.fields.comment.total = issue.fields.comment.comments.length + 1;
    route = (c) => c.path.startsWith('/rest/api/3/search/jql') && !c.path.includes('assignee%20is%20not%20EMPTY')
      ? { status: 200, body: { issues: [issue], isLast: true } }
      : jiraOnly(c);
    const d = await drill(input);
    expect(d.items.some((i) => i.id === 'jira:MS-1')).toBe(true);
    expect(d.sources.find((s) => s.source === 'jira')).toMatchObject({ ok: false, note: expect.stringContaining('additional issue evidence was not read') });
  });

  it('retains verified Confluence pages and marks a capped search as partial', async () => {
    route = (c) => {
      if (c.path.startsWith('/wiki/rest/api/search')) return { status: 200, body: { results: fx('cql').results.slice(0, 1), _links: { next: '/wiki/rest/api/search?cursor=more' } } };
      if (c.path.startsWith('/wiki/api/v2/pages')) return { status: 200, body: { results: [] } };
      return jiraOnly(c);
    };
    const d = await drill(input);
    expect(d.items.some((i) => i.id === 'conf:2293814')).toBe(true);
    expect(d.sources.find((s) => s.source === 'confluence')).toMatchObject({
      ok: false,
      note: expect.stringContaining('additional matching pages were not read'),
    });
  });

  it.each(['ownership', 'version history'])('marks Confluence coverage partial when page %s is truncated', async (kind) => {
    route = (c) => {
      if (c.path.startsWith('/wiki/rest/api/search')) return { status: 200, body: { results: fx('cql').results.slice(0, 1) } };
      if (c.path.includes('/versions')) return { status: 200, body: { results: [], ...(kind === 'version history' ? { _links: { next: '/versions?cursor=more' } } : {}) } };
      if (c.path.startsWith('/wiki/api/v2/pages')) return { status: 200, body: { results: [], ...(kind === 'ownership' ? { _links: { next: '/pages?cursor=more' } } : {}) } };
      return jiraOnly(c);
    };
    const d = await drill(input);
    expect(d.items.some((i) => i.id === 'conf:2293814')).toBe(true);
    expect(d.sources.find((s) => s.source === 'confluence')).toMatchObject({
      ok: false,
      note: expect.stringContaining(kind === 'ownership' ? 'additional page ownership was not read' : 'additional version history was not read'),
    });
  });

  it.each(['ownership', 'history', 'author lookup'])('keeps confirmed Confluence pages when %s is unavailable', async (unavailable) => {
    const search = { results: fx('cql').results.slice(0, 1) };
    route = (c) => {
      if (c.product === 'jira') {
        if (unavailable === 'author lookup' && c.path.includes('accountId=other-author')) return { status: 503 };
        return jiraOnly(c);
      }
      if (c.path.startsWith('/wiki/rest/api/search')) return { status: 200, body: search };
      if (c.path.startsWith('/wiki/api/v2/pages?')) return { status: unavailable === 'ownership' ? 503 : 200, body: { results: [] } };
      if (c.path.includes('/versions')) return { status: unavailable === 'history' ? 503 : 200, body: { results: [{ authorId: 'other-author' }] } };
      return { status: 404 };
    };
    const d = await drill(input);
    expect(d.items.find((i) => i.id === 'conf:2293814')).toMatchObject({ roles: ['page creator'] });
    expect(d.sources.find((s) => s.source === 'confluence')).toMatchObject({ ok: false, count: 1, note: expect.stringContaining(unavailable) });
  });

  it('reports incomplete colleague graph coverage even when the primary graph succeeds', async () => {
    const graph = vi.fn(async (query: string, vars: Record<string, unknown>) => {
      if (query.includes('standby_teams')) {
        return { data: { atlassianUserInTeams: { edges: [{ node: { id: 'code-team', displayName: 'Code' } }] } } };
      }
      if (query.includes('standby_members')) {
        return { data: { atlassianTeamMembers: { edges: [{ node: { accountId: 'peer-123', name: 'Peer' } }] } } };
      }
      if (query.includes('standby_work') && vars['u'] !== `ari:cloud:identity::user/${ALANA}`) {
        throw new Error('Colleague work inaccessible');
      }
      return { data: {} };
    });
    const rest = async (path: string) => res(jiraOnly({ product: 'jira', path, method: 'GET' }));
    const result = await drill(input, { jira: rest, conf: async () => res({ status: 503 }), graph });
    expect(result.sources.find((s) => s.source === 'graph')).toMatchObject({
      ok: false,
      note: expect.stringContaining('colleague graph lookups failed'),
    });
    expect(result.sources.find((s) => s.source === 'jira')).toMatchObject({ ok: true });
    expect(result.items.length).toBeGreaterThan(0);
  });

  it.each(['full drill', 'issue panel'])('reports the unqueried graph candidates in the %s', async (kind) => {
    const issue = { key: 'MS-1', fields: { summary: 'Open work', assignee: { accountId: ALANA, displayName: 'Alana Grant' } } };
    const jira = async (path: string) => {
      if (path.startsWith('/rest/api/3/issue/')) return res({ status: 200, body: issue });
      if (path.startsWith('/rest/api/3/search/jql')) return res({ status: 200, body: { issues: [] } });
      return res(jiraOnly({ product: 'jira', path, method: 'GET' }));
    };
    const graph = vi.fn(async (query: string, variables: Record<string, unknown>) => {
      if (query.includes('standby_teams')) {
        return { data: { atlassianUserInTeams: { edges: [{ node: { id: 'code-team', displayName: 'Code' } }] } } };
      }
      if (query.includes('standby_members')) {
        const edges = Array.from({ length: 14 }, (_, i) => ({ node: { accountId: `peer-${i}`, name: `Peer ${i}` } }));
        return { data: { atlassianTeamMembers: { edges } } };
      }
      if (query.includes('standby_assigned')) {
        return { data: { atlassianUserAssignedJiraWorkItems: { edges: [{ node: { key: issue.key } }] } } };
      }
      if (query.includes('standby_work') && variables.u === 'ari:cloud:identity::user/peer-0') {
        return { data: { atlassianUserWorkQuery: { edges: [{ node: { key: issue.key, __typename: 'JiraWorkItem' } }] } } };
      }
      return { data: {} };
    });
    const clients = { jira, conf: async () => res({ status: 503 }), graph };
    const result = kind === 'full drill'
      ? await drill(input, clients)
      : await issueCover({ ...input, issueKey: issue.key }, clients);

    const item = 'items' in result ? result.items.find((entry) => entry.key === issue.key) : result.item;
    expect(item?.touchedBy).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: 'peer-0' })]));
    expect(graph.mock.calls.filter(([query, vars]) => query.includes('standby_work') && String(vars.u).includes('/peer-'))).toHaveLength(12);
    expect(result.sources.find((source) => source.source === 'graph')).toMatchObject({
      ok: false,
      note: expect.stringContaining('2 additional colleague graph lookups were not run'),
    });
  });
});

describe('writes', () => {
  const to = { accountId: '5b10a2844c20165700ede21g', name: 'Backup' };

  it('does not reassign anything without confirmation', async () => {
    await expect(handlers['reassign']!({ payload: { changes: [{ key: 'MS-1', to }], confirmed: false } })).rejects.toThrow('Confirm');
    expect(calls).toHaveLength(0);
  });

  it('caps a reassignment batch at 50 issues', async () => {
    const changes = Array.from({ length: 51 }, (_, i) => ({ key: `MS-${i + 1}`, to }));
    await expect(handlers['reassign']!({ payload: { changes, confirmed: true } })).rejects.toThrow('at most 50');
    expect(calls).toHaveLength(0);
  });

  it('reports each refused reassignment without hiding the ones that worked', async () => {
    route = (c) => (c.path.includes('MS-2') ? { status: 403 } : { status: 204 });
    const out = await handlers['reassign']!({
      payload: { changes: [{ key: 'MS-1', to }, { key: 'MS-2', to }, { key: 'not a key', to }], confirmed: true },
    });
    expect(out).toEqual([
      { key: 'MS-1', to, ok: true, error: undefined },
      { key: 'MS-2', to, ok: false, error: 'Jira refused to reassign MS-2 (403)' },
      { key: 'not a key', to, ok: false, error: 'Not an issue key' },
    ]);
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.path)).toEqual(['/rest/api/3/issue/MS-1/assignee', '/rest/api/3/issue/MS-2/assignee']);
  });

  it('does not create a handover page without confirmation or a valid space', async () => {
    await expect(handlers['handover']!({ payload: { ...input, spaceId: '1', confirmed: false } })).rejects.toThrow('Confirm');
    await expect(handlers['handover']!({ payload: { ...input, spaceId: '1 OR 1=1', confirmed: true } })).rejects.toThrow('Pick a space');
    expect(calls).toHaveLength(0);
  });

  it('creates the handover as a draft, never a published page', async () => {
    route = (c) => (c.product === 'confluence' && c.method === 'POST' ? { status: 200, body: { id: '42', _links: { base: 'https://x/wiki', editui: '/e/42' } } } : jiraOnly(c));
    const out = await handlers['handover']!({ payload: { ...input, spaceId: '98', confirmed: true } });
    const post = calls.find((c) => c.method === 'POST');
    expect(post).toMatchObject({ product: 'confluence', path: '/wiki/api/v2/pages' });
    expect(JSON.parse(post!.body!)).toMatchObject({ spaceId: '98', status: 'draft', title: expect.stringContaining('Alana Grant') });
    expect(out).toEqual({ id: '42', url: 'https://x/wiki/e/42' });
  });

  it('does not create a draft with a substitute for a selected backup that disappeared', async () => {
    let author = { accountId: 'first-backup', displayName: 'First backup' };
    route = (c) => {
      if (c.product === 'confluence' && c.method === 'POST') return { status: 200, body: { id: '42' } };
      if (c.path.includes('fields=summary')) {
        return { status: 200, body: { issues: [{ key: 'MS-1', fields: { summary: 'Vendor agreement', reporter: author } }] } };
      }
      return jiraOnly(c);
    };
    const [item] = (await drill(input)).items.filter((entry) => entry.id === 'jira:MS-1');
    const picked = item!.backups[0]!.person.accountId;
    author = { accountId: 'other-backup', displayName: 'Other backup' };
    await expect(handlers['handover']!({ payload: {
      ...input, spaceId: '98', confirmed: true, picks: { [item!.id]: picked },
    } })).rejects.toThrow('Run the drill again');
    expect(calls.some((c) => c.product === 'confluence' && c.method === 'POST')).toBe(false);

    await handlers['handover']!({ payload: {
      ...input, spaceId: '98', confirmed: true, picks: { [item!.id]: author.accountId },
    } });
    const post = calls.find((c) => c.product === 'confluence' && c.method === 'POST');
    expect(post?.body).toContain('Other backup');
  });

  it.each(['item', 'backup'])('does not create a draft after an unreviewed %s appears', async (change) => {
    let refreshed = false;
    route = (c) => {
      if (c.product === 'confluence' && c.method === 'POST') return { status: 200, body: { id: '42' } };
      if (c.path.startsWith('/rest/api/3/project/search')) return { status: 200, body: { values: [] } };
      if (c.path.includes('fields=summary')) {
        const reporter = refreshed && change === 'backup' ? { accountId: 'new-backup', displayName: 'New backup' } : undefined;
        const issues = [{ key: 'MS-1', fields: { summary: 'Vendor agreement', reporter } }];
        if (refreshed && change === 'item') issues.push({ key: 'MS-2', fields: { summary: 'New work', reporter: undefined } });
        return { status: 200, body: { issues } };
      }
      return jiraOnly(c);
    };
    const shown = await drill(input);
    expect(shown.items.map(({ id, backups }) => [id, backups.length])).toEqual([['jira:MS-1', 0]]);
    const payload = { ...input, spaceId: '98', confirmed: true, reviewedBackups: { 'jira:MS-1': null } };

    refreshed = true;
    await expect(handlers['handover']!({ payload })).rejects.toThrow('Run the drill again');
    expect(calls.some((c) => c.product === 'confluence' && c.method === 'POST')).toBe(false);

    refreshed = false;
    await expect(handlers['handover']!({ payload })).resolves.toMatchObject({ id: '42' });
    expect(calls.filter((c) => c.product === 'confluence' && c.method === 'POST')).toHaveLength(1);
  });

  it.each([
    [undefined, '/pages/resumedraft.action?draftId=42'],
    [{ editui: '/pages/resumedraft.action?draftId=42&src=handover' }, '/pages/resumedraft.action?draftId=42&src=handover'],
  ])('returns the confirmed draft URL even without a Confluence base link', async (links, path) => {
    route = (c) => (c.product === 'confluence' && c.method === 'POST' ? { status: 200, body: { id: '42', _links: links } } : jiraOnly(c));
    const out = await handlers['handover']!({ payload: { ...input, spaceId: '98', confirmed: true } });

    expect(out).toEqual({ id: '42', url: `${SITE}/wiki${path}` });
    expect(calls.filter((c) => c.method === 'POST' && c.product === 'confluence')).toHaveLength(1);
  });
});

describe('issue panel', () => {
  const ms1 = () => fx('jira-assigned').issues[0];
  const ctx = (key: string) => ({ extension: { type: 'jira:issuePanel', issue: { key } } });
  const assignee = { accountId: ALANA, accountType: 'atlassian', displayName: 'Alana Grant' };
  const panel = (key: string, issue: unknown) => {
    route = (c) => (c.path.startsWith(`/rest/api/3/issue/${key}?`) ? { status: 200, body: issue } : c.path.startsWith('/rest/api/3/search/jql') ? { status: 200, body: { issues: [] } } : { status: 404 });
    return handlers['issue']!({ payload: { from: input.from, to: input.to, siteUrl: SITE, issueKey: 'EVIL-1' }, context: ctx(key) });
  };

  it('drills the issue in view, taken from the Forge context rather than the payload', async () => {
    const issue = ms1();
    issue.fields.assignee = assignee;
    const out = (await panel(issue.key, issue)) as { person: { name: string }; item: { key: string; coverage: string; backups: unknown[] } };
    expect(out.person.name).toBe('Alana Grant');
    expect(out.item.key).toBe(issue.key);
    expect(['stalls', 'thin', 'covered']).toContain(out.item.coverage);
    expect(calls.some((c) => c.path.includes('EVIL-1'))).toBe(false);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('marks the issue panel partial when the issue comment expansion is truncated', async () => {
    const issue = ms1();
    issue.fields.assignee = assignee;
    issue.fields.comment.total = issue.fields.comment.comments.length + 1;
    const out = await panel(issue.key, issue);
    expect(out).toMatchObject({
      item: { key: issue.key },
      sources: expect.arrayContaining([{ source: 'jira', label: 'Jira', count: 1, ok: false, note: expect.stringContaining('additional issue evidence was not read') }]),
    });
  });

  it('still drills an issue whose assignee has been deactivated', async () => {
    const issue = ms1();
    issue.fields.assignee = { ...assignee, active: false };
    const out = (await panel(issue.key, issue)) as { person: { name: string }; item: { key: string } };
    expect(out.person.name).toBe('Alana Grant');
    expect(out.item.key).toBe(issue.key);
  });

  it('treats an issue assigned to an app as unassigned', async () => {
    const issue = ms1();
    issue.fields.assignee = { accountId: '557058:bot', accountType: 'app', displayName: 'Automation for Jira', active: true };
    expect(await panel(issue.key, issue)).toEqual({ person: null, item: null, sources: [] });
  });

  it('does not flag a done issue', async () => {
    const issue = ms1();
    issue.fields.assignee = assignee;
    issue.fields.status = { name: 'Done', statusCategory: { key: 'done' } };
    expect(await panel(issue.key, issue)).toMatchObject({ item: null, done: true });
  });

  it('says so for an unassigned issue', async () => {
    const issue = ms1();
    issue.fields.assignee = null;
    expect(await panel(issue.key, issue)).toEqual({ person: null, item: null, sources: [] });
  });

  it('rejects a context without an issue key', async () => {
    await expect(handlers['issue']!({ payload: { from: input.from, to: input.to, siteUrl: SITE }, context: {} })).rejects.toThrow('Not an issue key');
    expect(calls).toHaveLength(0);
  });
});
