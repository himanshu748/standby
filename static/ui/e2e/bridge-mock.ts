/**
 * Mock of the parts of @forge/bridge the UI uses, for filming outside Atlassian.
 * Fixture data only — same shapes as src/core/model.ts.
 */
type Person = { accountId: string; name: string };
type Coverage = 'stalls' | 'thin' | 'covered';

const alana = { accountId: 'a-alana', name: 'Alana Rivera' };
const bench1 = { accountId: 'a-bharat', name: 'Bharat Kumar' };
const bench2 = { accountId: 'a-celia', name: 'Celia Osei' };
const bench3 = { accountId: 'a-dmitri', name: 'Dmitri Volkov' };
const me = { accountId: 'a-me', name: 'You' };

function item(
  id: string, kind: string, title: string, key: string | undefined, container: string,
  coverage: Coverage, urgency: number, urgencyNotes: string[], touched: [Person, string][],
  backups: [Person, string][], roles: string[], status = 'In Progress', dueAt?: string,
) {
  return {
    id, kind, title, key, url: '#', container: { id: container, name: container },
    status, dueAt, updatedAt: '2026-11-24', roles,
    sources: ['jira', 'confluence', 'graph'],
    touchedBy: touched.map(([p, how]) => ({ ...p, how })),
    coverage, urgency, urgencyNotes,
    backups: backups.map(([p, text], i) => ({
      person: p, score: 90 - i * 15,
      reasons: [{ kind: 'touched', text }],
    })),
  };
}

const items = [
  item('i1', 'issue', 'Finalize vendor MSA renewal terms', 'LEO-4', 'Legal', 'stalls', 9,
    ['Due in 2 days', 'No one else has touched it'],
    [], [], ['assignee'], 'In Progress', '2026-11-27'),
  item('i2', 'issue', 'Q4 launch pricing sign-off', 'SAL-91', 'Sales', 'thin', 7,
    ['Due this week', 'Only one other person on record'],
    [[bench2, 'commented on it last week']],
    [[bench2, 'commented on it last week']], ['assignee'], 'In Progress', '2026-11-28'),
  item('i3', 'page', 'Migration runbook v3', undefined, 'Engineering', 'covered', 4,
    ['Three editors active this month'],
    [[bench1, 'edited it twice'], [bench3, 'commented on the cutover section']],
    [[bench1, 'edited it twice'], [bench3, 'commented on the cutover section']], ['page owner']),
  item('i4', 'issue', 'Renew SOC 2 evidence collection', 'SEC-12', 'Security', 'stalls', 8,
    ['External audit in January', 'No cover on record'],
    [], [], ['assignee', 'reporter'], 'To Do', '2026-12-05'),
  item('i5', 'project-lead', 'Mobile refresh project', 'MOB', 'Mobile', 'thin', 6,
    ['Project lead while out', 'One teammate active'],
    [[bench1, '4 open issues in Mobile']],
    [[bench1, '4 open issues in Mobile']], ['project lead']),
  item('i6', 'page', 'Partner onboarding checklist', undefined, 'Sales', 'covered', 2,
    ['Owned jointly with Sales ops'],
    [[bench2, 'co-edits weekly']],
    [[bench2, 'co-edits weekly']], ['page owner']),
  item('i7', 'issue', 'Accessibility audit follow-ups', 'PLAT-77', 'Platform', 'covered', 3,
    ['Two teammates active on it'],
    [[bench3, 'transitioned it last sprint'], [bench1, 'reported it']],
    [[bench3, 'transitioned it last sprint']], ['assignee'], 'In Progress'),
  item('i8', 'issue', 'Data retention exception request', 'LEG-18', 'Legal', 'stalls', 5,
    ['Waiting on her review', 'No cover on record'],
    [], [], ['assignee'], 'In Review', '2026-12-01'),
];

const drillData = {
  person: alana,
  window: { from: '2026-12-24', to: '2027-01-02' },
  items,
  bench: [
    { person: bench1, score: 86, items: ['Migration runbook v3', 'Mobile refresh project', 'Accessibility audit follow-ups'] },
    { person: bench2, score: 71, items: ['Q4 launch pricing sign-off', 'Partner onboarding checklist'] },
    { person: bench3, score: 54, items: ['Migration runbook v3', 'Accessibility audit follow-ups'] },
  ],
  counts: { stalls: 3, thin: 2, covered: 3 },
  sources: [
    { source: 'jira', label: 'Jira issues', ok: true, count: 5 },
    { source: 'confluence', label: 'Confluence pages', ok: true, count: 2 },
    { source: 'graph', label: 'Teamwork Graph', ok: true, count: 4 },
  ],
};

const peopleList = [alana, bench1, bench2, bench3, { accountId: 'a-elena', name: 'Elena Marchetti' }];

export async function invoke(name: string, payload?: Record<string, unknown>): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 60));
  if (name === 'me') return me;
  if (name === 'people') {
    const q = String(payload?.['query'] ?? '').toLowerCase();
    return peopleList.filter((p) => p.name.toLowerCase().includes(q.slice(0, 20)));
  }
  if (name === 'drill') {
    await new Promise((r) => setTimeout(r, 1800));
    if (new URLSearchParams(window.location.search).has('partialDrill')) {
      return {
        ...drillData,
        items: [],
        bench: [],
        counts: { stalls: 0, thin: 0, covered: 0 },
        sources: drillData.sources.map((source) => ({ ...source, ok: false, count: 0, note: 'Fixture read unavailable' })),
      };
    }
    return drillData;
  }
  if (name === 'spaces') {
    return [
      { id: 'sp-eng', name: 'Engineering' },
      { id: 'sp-ops', name: 'Team Ops' },
    ];
  }
  if (name === 'handover') {
    await new Promise((r) => setTimeout(r, 1200));
    return { id: 'pg-1', url: '#handover-draft' };
  }
  if (name === 'reassign') {
    return (payload?.['changes'] as { key: string }[] ?? []).map((c) => ({ key: c.key, ok: true }));
  }
  if (name === 'issue') {
    return { person: alana, item: items[0], sources: drillData.sources };
  }
  throw new Error(`unknown ${name}`);
}

export const view = {
  getContext: async () => ({ moduleKey: 'standby-global', extension: {} }),
  theme: { enable: async () => undefined },
};

export const router = {
  open: async () => undefined,
  navigate: async () => undefined,
};
