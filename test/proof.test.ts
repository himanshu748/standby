import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { proofPageUrl, runProof, writeProof } from '../src/proof/run';
import type { Seed } from '../src/proof/world';

const seed = JSON.parse(readFileSync(new URL('./fixtures/seed-team.json', import.meta.url), 'utf8')) as Seed;

describe('seed fire drill', () => {
  it('covers a team and creates the handover draft', async () => {
    expect(new Set(seed.people.map((p) => p.accountId)).size).toBeGreaterThanOrEqual(5);
    const { drill, draft, page, calls, report, html } = await runProof(seed);

    expect(drill.person.name).toBe('Priya Shah');
    expect(drill.counts).toEqual({ stalls: 5, thin: 3, covered: 1 });
    expect(drill.items.map((i) => i.key ?? i.title)).toEqual([
      'MOBL-12',
      'GOAL-7',
      'ATLAS-3',
      'MOBL',
      'Checkout architecture',
      'MOBL-31',
      'MOBL-18',
      'Checkout on-call runbook',
      'MOBL-4',
    ]);

    const storms = drill.items.find((i) => i.key === 'MOBL-12')!;
    expect(storms.coverage).toBe('stalls');
    expect(storms.touchedBy).toEqual([]);
    expect(storms.urgencyNotes).toEqual(['due while they are out', 'High priority', 'in "In Progress"']);
    expect(storms.backups[0]?.person.name).toBe('Jonah Ellis');

    const wallet = drill.items.find((i) => i.key === 'MOBL-31')!;
    expect(wallet.coverage).toBe('thin');
    expect(wallet.touchedBy.map((t) => t.how)).toEqual(['works on it too, per Teamwork Graph']);
    expect(wallet.backups[0]?.person.name).toBe('Jonah Ellis');

    const apple = drill.items.find((i) => i.key === 'MOBL-4')!;
    expect(apple.coverage).toBe('covered');
    expect(apple.touchedBy.map((t) => t.name).sort()).toEqual(['Jonah Ellis', 'Samir Patel']);

    const runbook = drill.items.find((i) => i.title === 'Checkout on-call runbook')!;
    expect(runbook.coverage).toBe('thin');
    expect(runbook.backups[0]?.person.name).toBe('Mei Chen');

    const architecture = drill.items.find((i) => i.title === 'Checkout architecture')!;
    expect(architecture.coverage).toBe('stalls');
    expect(architecture.backups[0]).toMatchObject({ person: { name: 'Mei Chen' }, reasons: [{ text: 'edited 1 page in Mobile checkout' }] });

    const goal = drill.items.find((i) => i.key === 'GOAL-7')!;
    expect(goal.coverage).toBe('stalls');
    expect(goal.urgencyNotes).toEqual(['due while they are out', 'they are the named owner']);

    expect(drill.bench[0]).toMatchObject({ person: { name: 'Jonah Ellis' } });
    expect(drill.bench[0]?.items).toContain('jira:MOBL-12');
    expect(drill.sources.map((s) => [s.source, s.ok])).toEqual([
      ['graph', true],
      ['jira', true],
      ['confluence', true],
    ]);
    expect(drill.sources.find((s) => s.source === 'graph')?.note).toContain("colleagues' graphs");

    expect(draft).toMatchObject({
      spaceId: '88421',
      status: 'draft',
      title: 'Handover: Priya Shah, 2026-12-08 to 2026-12-19',
    });
    expect(draft.storage).toContain('MOBL-12 Checkout 3DS retry storms');
    expect(draft.storage).toContain('works on it too, per Teamwork Graph');
    expect(draft.storage).toContain('<h2>Stalls without them (5)</h2>');
    expect(draft.storage).toContain('<h2>One other person (3)</h2>');
    expect(draft.storage).toContain('<h2>Covered (1)</h2>');
    expect(draft.storage).toContain('<li><strong>Jonah Ellis</strong>:');
    expect(draft.status).not.toBe('current');
    expect(page).toEqual({ id: '91002', url: 'https://northwind.atlassian.net/wiki/pages/resumedraft.action?draftId=91002' });
    expect(calls.filter((c) => c.method !== 'GET' && c.product !== 'graph').map((c) => [c.method, c.path])).toEqual([['POST', '/wiki/api/v2/pages']]);
    expect(html).toContain(draft.storage);
    expect(report).toContain('Handover draft created');

    if (process.env['PROOF_WRITE'] === '1') {
      writeProof(html);
      console.log(`\n${report}\n\nwrote ${proofPageUrl.pathname}\n`);
    } else {
      expect(readFileSync(proofPageUrl, 'utf8')).toBe(html);
    }
  });
});
