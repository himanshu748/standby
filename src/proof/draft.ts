import { escapeXml } from '../core/handover';
import type { Call } from './world';

export type Draft = { spaceId: string; status: string; title: string; storage: string };

export function proofHtml(draft: Draft, url: string, walkthrough = false): string {
  const context = walkthrough
    ? 'Synthetic Confluence draft from the local walkthrough. Source links are examples.'
    : `Draft page created by <code>npm run proof</code> for space ${escapeXml(draft.spaceId)}. Status: ${escapeXml(draft.status)}. ${escapeXml(url)}`;
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
${walkthrough ? `<h1>${escapeXml(draft.title)}</h1>\n` : ''}<p class="banner">${context}</p>
${draft.storage}
</body>
</html>
`;
}

export function draftFromCalls(calls: Call[]): Draft {
  const post = calls.find((c) => c.method === 'POST' && c.path === '/wiki/api/v2/pages');
  if (!post?.body) throw new Error('handover draft was not created');
  const body = JSON.parse(post.body) as { spaceId: string; status: string; title: string; body: { representation: string; value: string } };
  return { spaceId: body.spaceId, status: body.status, title: body.title, storage: body.body.value };
}
