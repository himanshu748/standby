import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPages, parseSearch } from '../src/adapters/confluence';
import { graphSignals, parseAssigned, parseContent, parseOwns } from '../src/adapters/graph';
import { parseIssues, parseLeads, parsePeers } from '../src/adapters/jira';
import { toPerson } from '../src/adapters/people';

// Fixtures are trimmed responses captured from the development site (one-atlas-obka).
const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const SITE = 'https://one-atlas-obka.atlassian.net';
const ALANA = '60ad2d2a06bf0c006a42fa84';

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
  it('parses curated query results', () => {
    const assigned = parseAssigned(
      { atlassianUserAssignedJiraWorkItems: { edges: [
        { node: { key: 'SALES-27', summary: 'Quote', webUrl: 'w', status: { name: 'To Do', statusCategory: { key: 'new' } }, reporter: u('m', 'Mitch Davis') } },
        { node: { key: 'SALES-1', summary: 'Old', webUrl: 'w', status: { name: 'Done', statusCategory: { key: 'done' } } } },
      ] } },
      ALANA,
    );
    expect(assigned).toEqual([expect.objectContaining({ id: 'jira:SALES-27', sources: ['graph'], touchedBy: [{ accountId: 'm', name: 'Mitch Davis', how: 'reported SALES-27' }] })]);
    const content = parseContent({ atlassianUserContent: { edges: [{ node: { __typename: 'ConfluencePage', pageId: '9', title: 'Runbook', webUrl: 'w', space: { key: 'HR', name: 'Human Resources' }, owner: u(ALANA, 'Alana Grant'), lastEditor: u('c', 'Cassi Owens') } }] } }, ALANA);
    expect(content[0]).toMatchObject({ id: 'conf:9', container: { id: 'conf:HR' }, touchedBy: [{ name: 'Cassi Owens', how: 'last edited "Runbook"' }] });
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
});
