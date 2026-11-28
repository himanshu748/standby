import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Drill } from '../core/model';
import { createHandover } from '../service';
import { clientsFromSeed, type Call, type Seed } from './world';

import { draftFromCalls, proofHtml, type Draft } from './draft';

export type Proof = {
  drill: Drill;
  page: { id: string; url: string };
  draft: Draft;
  calls: Call[];
  report: string;
  html: string;
};

export const proofPageUrl = new URL('../../proof/handover-page.html', import.meta.url);

export function proofReport(drill: Drill, page: { id: string; url: string }, draft: Draft): string {
  const lines = [`Standby proof · ${drill.person.name} · ${drill.window.from} to ${drill.window.to}`];
  for (const source of drill.sources) lines.push(`${source.label}: ${source.ok ? 'ok' : 'partial'} · ${source.count} · ${source.note ?? ''}`);
  lines.push('', `Stalls ${drill.counts.stalls} · Thin ${drill.counts.thin} · Covered ${drill.counts.covered}`);
  for (const coverage of ['stalls', 'thin', 'covered'] as const) {
    lines.push('', coverage.toUpperCase());
    for (const item of drill.items.filter((i) => i.coverage === coverage)) {
      const backup = item.backups[0];
      const who = backup ? `${backup.person.name} (${backup.reasons.map((r) => r.text).join('; ')})` : 'nobody found';
      lines.push(`- ${item.key ?? item.kind}  ${item.title}`);
      lines.push(`  ${item.urgencyNotes.join(', ') || 'no urgency marks'}`);
      lines.push(`  backup: ${who}`);
    }
  }
  lines.push('', 'Handover draft created', `  title: ${draft.title}`, `  id: ${page.id}`, `  url: ${page.url}`, `  space: ${draft.spaceId}`, `  status: ${draft.status}`);
  return lines.join('\n');
}

/** Runs the real drill and draft-page path against the seed. Nothing is sent to Atlassian. */
export async function runProof(seed: Seed): Promise<Proof> {
  const { jira, conf, graph, calls } = clientsFromSeed(seed);
  const { drill, page } = await createHandover(
    { accountId: seed.out, from: seed.window.from, to: seed.window.to, siteUrl: seed.site, spaceId: seed.handoverSpaceId, confirmed: true },
    { jira, conf, graph },
  );
  const draft = draftFromCalls(calls);
  return { drill, page, draft, calls, report: proofReport(drill, page, draft), html: proofHtml(draft, page.url) };
}

export function writeProof(html: string): void {
  const path = fileURLToPath(proofPageUrl);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}
