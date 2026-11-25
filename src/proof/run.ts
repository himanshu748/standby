import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeXml } from '../core/handover';
import type { Drill } from '../core/model';
import { createHandover } from '../index';
import { clientsFromSeed, type Call, type Seed } from './world';

export type Draft = { spaceId: string; status: string; title: string; storage: string };

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

export function proofHtml(draft: Draft, url: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeXml(draft.title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 920px; margin: 32px auto; color: #172b4d; padding: 0 16px; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 24px; }
  td, th { border: 1px solid #dcdfe4; padding: 8px 10px; vertical-align: top; text-align: left; }
  th { background: #f7f8f9; }
  .banner { background: #fff7e6; border: 1px solid #f5cd47; padding: 12px 16px; border-radius: 8px; }
</style>
</head>
<body>
<p class="banner">Draft page created by <code>npm run proof</code> for space ${escapeXml(draft.spaceId)}. Status: ${escapeXml(draft.status)}. ${escapeXml(url)}</p>
${draft.storage}
</body>
</html>
`;
}

/** Runs the real drill and draft-page path against the seed. Nothing is sent to Atlassian. */
export async function runProof(seed: Seed): Promise<Proof> {
  const { jira, conf, graph, calls } = clientsFromSeed(seed);
  const { drill, page } = await createHandover(
    { accountId: seed.out, from: seed.window.from, to: seed.window.to, siteUrl: seed.site, spaceId: seed.handoverSpaceId, confirmed: true },
    { jira, conf, graph },
  );
  const post = calls.find((c) => c.method === 'POST' && c.path === '/wiki/api/v2/pages');
  if (!post?.body) throw new Error('handover draft was not created');
  const body = JSON.parse(post.body) as { spaceId: string; status: string; title: string; body: { representation: string; value: string } };
  const draft: Draft = { spaceId: body.spaceId, status: body.status, title: body.title, storage: body.body.value };
  return { drill, page, draft, calls, report: proofReport(drill, page, draft), html: proofHtml(draft, page.url) };
}

export function writeProof(html: string): void {
  const path = fileURLToPath(proofPageUrl);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}
