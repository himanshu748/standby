import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildPages, listSpaces, parseSearch } from '../src/adapters/confluence';
import { coLinks, graphCoverage, graphSignals, parseAssigned, parseOwns, parseWork } from '../src/adapters/graph';
import { parseIssues, parseLeads, parsePeers } from '../src/adapters/jira';
import { toPerson } from '../src/adapters/people';

// Fixtures are trimmed responses captured from the development site (one-atlas-obka).
const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const SITE = 'https://one-atlas-obka.atlassian.net';
const ALANA = '60ad2d2a06bf0c006a42fa84';

describe('handover spaces', () => {
  const first = { id: 10, key: 'ENG', name: 'Engineering' };
  const second = { id: 20, key: 'OPS', name: 'Operations' };
  const page = (results: object[], next?: string) => ({ ok: true, status: 200, json: async () => ({ results, _links: { next } }) });

  it('keeps current spaces from later pages in the handover picker', async () => {
    const conf = vi.fn().mockResolvedValueOnce(page([first], '/wiki/api/v2/spaces?cursor=next%2B%3D'))
      .mockResolvedValueOnce(page([second]));

    expect(await listSpaces(conf)).toEqual([{ ...first, id: '10' }, { ...second, id: '20' }]);
    expect(conf.mock.calls).toEqual([
      ['/wiki/api/v2/spaces?limit=100&status=current'],
      ['/wiki/api/v2/spaces?limit=100&status=current&cursor=next%2B%3D'],
    ]);
  });

  it('rejects a repeated space cursor', async () => {
    const conf = vi.fn().mockResolvedValue(page([first], '/wiki/api/v2/spaces?cursor=repeat'));
    await expect(listSpaces(conf)).rejects.toThrow('Confluence space pagination did not advance');
    expect(conf).toHaveBeenCalledTimes(2);
  });
});

describe('toPerson', () => {
  it('keeps active humans and drops apps, bots and former users', () => {
    expect(toPerson({ accountId: 'a', accountType: 'atlassian', displayName: 'Ryan Lee', active: true })).toEqual({ accountId: 'a', name: 'Ryan Lee' });
    expect(toPerson({ accountId: 'b', accountType: 'app', displayName: 'Automation for Jira' })).toBeUndefined();
    expect(toPerson({ accountId: 'c', accountType: 'atlassian', displayName: 'field-demo-bot' })).toBeUndefined();
    expect(toPerson({ accountId: 'd', displayName: 'Former user' })).toBeUndefined();
    expect(toPerson({ accountId: 'e', displayName: 'Kevin Campbell', active: false })).toBeUndefined();
  });
});

describe('jira', () => {
  it('turns assigned issues into items with the other humans who touched them', () => {
    const items = parseIssues(fx('jira-assigned'), SITE, ALANA);
    expect(items).toHaveLength(6);
    const first = items[0]!;
    expect(first).toMatchObject({ id: 'jira:MS-1', kind: 'issue', roles: ['assignee'], sources: ['jira'], url: `${SITE}/browse/MS-1` });
    for (const item of items) {
      expect(item.touchedBy.every((t) => t.accountId !== ALANA && t.how.includes(item.key!))).toBe(true);
      expect(item.touchedBy.some((t) => /bot|Automation/i.test(t.name))).toBe(false);
    }
  });
  it('finds projects the person leads', () => {
    const json = fx('projects');
    const lead = json.values[0].lead.accountId;
    const items = parseLeads(json, SITE, lead);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toMatchObject({ kind: 'project-lead', roles: ['project lead'] });
  });
  it('counts open work per project and person', () => {
    const peers = parsePeers({
      issues: [
        { fields: { project: { key: 'SALES', name: 'Sales' }, assignee: { accountId: 'm', displayName: 'Mitch Davis' } } },
        { fields: { project: { key: 'SALES', name: 'Sales' }, assignee: { accountId: 'm', displayName: 'Mitch Davis' } } },
        { fields: { project: { key: 'SALES', name: 'Sales' }, assignee: { accountId: 'r', displayName: 'Ryan Lee' } } },
      ],
    });
    expect(peers['jira:SALES']?.map((p) => p.note)).toEqual(['2 open in Sales', '1 open in Sales']);
  });
});

describe('confluence', () => {
  it('counts distinct pages when explaining a backup’s space experience', () => {
    const pages = [
      { id: '1', title: 'Runbook', url: 'https://example.com/1', space: { id: 'conf:OPS', name: 'Operations' }, ownerId: ALANA },
      { id: '2', title: 'On-call checklist', url: 'https://example.com/2', space: { id: 'conf:OPS', name: 'Operations' }, ownerId: ALANA },
    ];
    const editor = { accountId: 'm', name: 'Mitch Davis' };
    const { peers } = buildPages(pages, { '1': ['m', ALANA, 'm'], '2': ['m'] }, new Map([['m', editor]]), ALANA);
    expect(peers['conf:OPS']).toEqual([{ person: editor, note: 'edited 2 pages in Operations' }]);
  });

  it('parses search results and marks roles from owner, creator and versions', () => {
    const pages = parseSearch(fx('cql'), SITE);
    expect(pages[0]).toMatchObject({ id: '2293814', title: 'Dashloop Synchronization Architecture', space: { id: 'conf:ENGS', name: 'Engineering Support' }, creatorId: ALANA });
    expect(pages[0]!.url).toBe(`${SITE}/wiki/spaces/ENGS/pages/2293814/Dashloop+Synchronization+Architecture`);
    const people = new Map([['m', { accountId: 'm', name: 'Mitch Davis' }]]);
    const { items, peers } = buildPages(
      [{ ...pages[0]!, ownerId: ALANA }, { ...pages[1]!, creatorId: 'm' }],
      { [pages[0]!.id]: [ALANA, ALANA], [pages[1]!.id]: ['m'] },
      people,
      ALANA,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ roles: ['page owner', 'page creator', 'last editor'], touchedBy: [] });
    expect(Object.values(peers).flat()[0]?.note).toMatch(/^edited 1 page in /);
  });
});

describe('teamwork graph', () => {
  const u = (accountId: string, name: string) => ({ accountId, name });
  it('reports partial teammate evidence when only the first three teams are read', async () => {
    const teams = ['Sales', 'Support', 'Engineering', 'Finance'];
    const memberReads: string[] = [];
    const result = await graphSignals(async (query, variables) => {
      if (query.includes('standby_teams')) {
        return { data: { atlassianUserInTeams: { edges: teams.map((displayName, i) => ({ node: { id: `ari:team/${i}`, displayName } })) } } };
      }
      if (query.includes('standby_members')) {
        memberReads.push(String(variables.t));
        return { data: { atlassianTeamMembers: { edges: [{ node: u('m', 'Mitch Davis') }] } } };
      }
      return { data: {} };
    }, ALANA);

    expect(result.teams).toEqual(teams);
    expect(memberReads).toEqual(['ari:team/0', 'ari:team/1', 'ari:team/2']);
    expect(result.teammates).toEqual([{ person: { accountId: 'm', name: 'Mitch Davis' }, team: 'Sales' }]);
    expect(result.errors).toContain('Teamwork Graph member lookups limited to 3 of 4 teams');
  });
  it('parses curated query results', () => {
    const assigned = parseAssigned(
      { atlassianUserAssignedJiraWorkItems: { edges: [
        { node: { key: 'SALES-27', summary: 'Quote', webUrl: 'w', status: { name: 'To Do', statusCategory: { key: 'new' } }, reporter: u('m', 'Mitch Davis') } },
        { node: { key: 'SALES-1', summary: 'Old', webUrl: 'w', status: { name: 'Done', statusCategory: { key: 'done' } } } },
      ] } },
      ALANA,
    );
    expect(assigned).toEqual([expect.objectContaining({ id: 'jira:SALES-27', sources: ['graph'], touchedBy: [{ accountId: 'm', name: 'Mitch Davis', how: 'reported SALES-27' }] })]);
    const work = parseWork({ atlassianUserWorkQuery: { edges: [
      { node: { __typename: 'ConfluencePage', pageId: '9', title: 'Runbook', webUrl: 'w', space: { key: 'HR', name: 'Human Resources' }, owner: u(ALANA, 'Alana Grant'), lastEditor: u('c', 'Cassi Owens') } },
      { node: { __typename: 'ConfluenceBlogPost', id: 'ari:cloud:confluence:x:blogpost/77', title: 'Payroll update', lastEditor: u(ALANA, 'Alana Grant') } },
      { node: { __typename: 'ConfluencePage', pageId: '5', title: 'Watched only', owner: u('c', 'Cassi Owens') } },
      { node: { __typename: 'JiraWorkItem', key: 'LEO-54', summary: 'Launch', status: { name: 'Done', statusCategory: { key: 'done' } } } },
      null,
      { node: { __typename: 'ConfluenceComment', id: 'c1' } },
      { node: { __typename: 'JiraWorkItem', key: 'SALES-9', summary: 'Quote', assignee: u(ALANA, 'Alana Grant'), status: { name: 'To Do', statusCategory: { key: 'new' } } } },
    ] } }, ALANA, 'https://s');
    expect(work.map((i) => i.id)).toEqual(['conf:9', 'conf:77', 'jira:SALES-9']);
    expect(work[1]?.url).toBe('https://s/wiki/pages/viewpage.action?pageId=77');
    expect(work[2]).toMatchObject({ roles: ['assignee'], url: 'https://s/browse/SALES-9' });
    expect(work[0]).toMatchObject({ container: { id: 'conf:HR' }, roles: ['page owner'], touchedBy: [{ name: 'Cassi Owens', how: 'last edited "Runbook"' }] });
    expect(parseOwns({ atlassianUserGoalsAndProjects: { edges: [{ node: { __typename: 'AtlassianGoal', id: 'g', name: 'Ship v2', url: 'u' } }] } })[0]).toMatchObject({ kind: 'goal', roles: ['goal owner'] });
  });
  it('keeps going when one query fails and reports why', async () => {
    const r = await graphSignals(async (query) => {
      if (query.includes('standby_teams')) return { data: { atlassianUserInTeams: { edges: [{ node: { id: 'ari:team/1', displayName: 'Revenue' } }] } } };
      if (query.includes('standby_members')) return { data: { atlassianTeamMembers: { edges: [{ node: u('m', 'Mitch Davis') }, { node: u(ALANA, 'Alana Grant') }] } } };
      if (query.includes('standby_owns')) return { errors: [{ message: 'scope missing' }] };
      return { data: {} };
    }, ALANA);
    expect(r.teammates).toEqual([{ person: { accountId: 'm', name: 'Mitch Davis' }, team: 'Revenue' }]);
    expect(r.errors).toEqual(['scope missing']);
    expect(r.teams).toEqual(['Revenue']);
    expect(r.counts.work).toBe(r.items.filter((i) => i.kind === 'issue').length);
  });
  it('keeps usable graph items and reports partial responses and failed team lookups', async () => {
    const r = await graphSignals(async (query) => {
      if (query.includes('standby_teams')) {
        return { data: { atlassianUserInTeams: { edges: [{ node: { id: 'ari:team/1', displayName: 'Sales' } }] } } };
      }
      if (query.includes('standby_members')) return { errors: [{ message: 'team read denied' }] };
      if (query.includes('standby_assigned')) {
        return {
          data: { atlassianUserAssignedJiraWorkItems: { edges: [{ node: { key: 'SALES-27' } }] } },
          errors: [{ message: 'some assignments unavailable' }],
        };
      }
      return { data: {} };
    }, ALANA);
    expect(r.items.map((item) => item.id)).toEqual(['jira:SALES-27']);
    expect(r.errors).toEqual(['some assignments unavailable', 'team read denied']);
  });

  it('keeps overlap from a partial colleague graph', async () => {
    const page = { id: 'conf:9', kind: 'page' as const, title: 'Runbook', url: 'w', roles: ['linked page'], sources: ['graph' as const], touchedBy: [] };
    const graph = await graphCoverage(async () => ({
      data: { atlassianUserWorkQuery: { edges: [{ node: { __typename: 'ConfluencePage', pageId: '9' } }] } },
      errors: [{ message: 'other work omitted' }],
    }), [page], [u('m', 'Mitch Davis')]);
    expect(graph).toMatchObject({ checked: 1, partial: 1, links: 1 });
  });

  it('keeps work from earlier pages when a later Graph page fails', async () => {
    const graph = await graphSignals(async (query, vars) => {
      if (!query.includes('standby_work')) return { data: {} };
      if (vars.after) return { errors: [{ message: 'cursor expired' }] };
      return { data: { atlassianUserWorkQuery: {
        edges: [{ node: { __typename: 'JiraWorkItem', key: 'SALES-27' } }],
        pageInfo: { hasNextPage: true, endCursor: 'second' },
      } } };
    }, ALANA);
    expect(graph.items.map((item) => item.id)).toEqual(['jira:SALES-27']);
    expect(graph.errors).toEqual(['Teamwork Graph work pagination stopped: cursor expired']);
  });

  it('marks capped Graph result lists as partial without discarding the returned data', async () => {
    const edges = (count: number, node: (i: number) => object) => Array.from({ length: count }, (_, i) => ({ node: node(i) }));
    const graph = await graphSignals(async (query, vars) => {
      if (query.includes('standby_teams')) return { data: { atlassianUserInTeams: {
        edges: [{ node: { id: 'team-1', displayName: 'Operations' } }],
      } } };
      if (query.includes('standby_members')) return { data: { atlassianTeamMembers: {
        edges: edges(25, (i) => u(`${vars.t}-peer-${i}`, `Peer ${i}`)),
      } } };
      if (query.includes('standby_assigned')) return { data: { atlassianUserAssignedJiraWorkItems: {
        edges: edges(25, (i) => ({ key: `OPS-${i + 1}` })),
      } } };
      if (query.includes('standby_owns')) return { data: { atlassianUserGoalsAndProjects: {
        edges: edges(25, (i) => ({ __typename: 'AtlassianGoal', id: `goal-${i}`, name: `Goal ${i}` })),
      } } };
      return { data: {} };
    }, ALANA);
    expect(graph.errors).toEqual([
      'Assigned Jira work: reached the 25-result limit. More results may be unread.',
      'Owned goals and projects: reached the 25-result limit. More results may be unread.',
      'Team members for Operations: reached the 25-result limit. More results may be unread.',
    ]);
    expect(graph.counts).toEqual({ work: 25, owned: 25, pages: 0 });
    expect(graph.teammates).toHaveLength(25);
  });

  it('reports a capped colleague search as partial while retaining overlap', async () => {
    const page = { id: 'conf:9', kind: 'page' as const, title: 'Runbook', url: 'w', roles: ['linked page'], sources: ['graph' as const], touchedBy: [] };
    const graph = await graphCoverage(async (_query, vars) => ({
      data: { atlassianUserWorkQuery: {
        edges: [{ node: { __typename: 'ConfluencePage', pageId: '9' } }],
        pageInfo: { hasNextPage: true, endCursor: vars.after ? 'third' : 'second' },
      } },
    }), [page], [u('m', 'Mitch Davis')]);
    expect(graph).toMatchObject({ checked: 1, partial: 1, links: 1 });
  });

  it('turns overlapping Teamwork Graph neighbourhoods into coverage', async () => {
    const page = { id: 'conf:9', kind: 'page' as const, title: 'Runbook', url: 'w', roles: ['linked page'], sources: ['graph' as const], touchedBy: [] };
    const mitch = u('m', 'Mitch Davis');
    const r = coLinks([page], [{ person: mitch, ids: new Set(['conf:9']) }, { person: u('c', 'Cassi Owens'), ids: new Set(['conf:1']) }]);
    expect(r.links).toBe(1);
    expect(r.items[0]!.touchedBy).toEqual([{ ...mitch, how: 'works on it too, per Teamwork Graph' }]);
    const pages: string[] = [];
    const g = await graphCoverage(async (_q, v) => {
      pages.push(String(v.after ?? 'first'));
      return v.after
        ? { data: { atlassianUserWorkQuery: { pageInfo: { hasNextPage: false }, edges: [{ node: { __typename: 'ConfluencePage', pageId: '9' } }] } } }
        : { data: { atlassianUserWorkQuery: { pageInfo: { hasNextPage: true, endCursor: 'c2' }, edges: [{ node: { __typename: 'ConfluencePage', pageId: '3' } }] } } };
    }, [page], [mitch]);
    expect(pages).toEqual(['first', 'c2']);
    expect(g).toMatchObject({ links: 1, checked: 1 });
  });
});
