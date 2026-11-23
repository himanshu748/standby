import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { product: 'jira' | 'confluence'; path: string; method: string; body?: string | undefined };
type Reply = { status: number; body?: unknown };
const calls: Call[] = [];
let route: (c: Call) => Reply;
let graphFails = false;

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
        return { json: async () => ({ data: {} }) };
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
});

describe('drill input', () => {
  it.each([
    [{ ...input, accountId: '' }, 'Pick a person first'],
    [{ ...input, from: '2026-12-12', to: '2026-12-01' }, 'Pick a valid absence window'],
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
