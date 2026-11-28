import { escapeXml } from '../../../src/core/handover';
import { runWalkthrough } from './transport';

function documentUrl(html: string) {
  return URL.createObjectURL(new Blob(['<!DOCTYPE html>', html], { type: 'text/html;charset=utf-8' }));
}

export async function invoke(name: string, payload?: Record<string, unknown>): Promise<unknown> {
  const result = await runWalkthrough(name, payload);
  if (name !== 'handover') return result;

  const draft = result as { id: string; html: string };
  const preview = new DOMParser().parseFromString(draft.html, 'text/html');
  for (const link of preview.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    link.title = link.href;
    link.removeAttribute('href');
  }
  return { id: draft.id, url: documentUrl(preview.documentElement.outerHTML) };
}

export const view = { getContext: () => invoke('context') };

export const router = {
  open: (url: string) => {
    const target = url.startsWith('blob:') ? url : documentUrl(`<html lang="en"><meta charset="utf-8"><title>Sample source</title><h1>Sample source</h1><p>${escapeXml(url)}</p><p>This source belongs to the local fixture.</p></html>`);
    window.open(target, '_blank', 'noopener');
  },
};
