import type { Person, Touch, WorkItem } from '../core/model';
import { getJson, q, type Json, type Rest } from './http';
import { toPerson } from './people';

export type PageFacts = { id: string; title: string; url: string; space: { id: string; name: string }; updatedAt?: string; ownerId?: string; creatorId?: string };

export function parseSearch(json: Json, siteUrl: string): PageFacts[] {
  return (json.results ?? [])
    .filter((r: Json) => r.content?.type === 'page')
    .map((r: Json): PageFacts => {
      const c = r.content;
      const page: PageFacts = {
        id: String(c.id),
        title: c.title,
        url: `${siteUrl}/wiki${c._links?.webui ?? r.url}`,
        space: { id: `conf:${c.space?.key}`, name: c.space?.name ?? c.space?.key },
      };
      if (c.version?.when) page.updatedAt = c.version.when;
      if (c.history?.createdBy?.accountId) page.creatorId = c.history.createdBy.accountId;
      return page;
    });
}

/** Turns pages plus their version authors into work items and per-space peers. */
export function buildPages(
  pages: PageFacts[],
  authorsByPage: Record<string, string[]>,
  people: Map<string, Person>,
  outId: string,
): { items: WorkItem[]; peers: Record<string, { person: Person; note: string }[]> } {
  const items: WorkItem[] = [];
  const edits = new Map<string, Map<string, number>>();
  for (const page of pages) {
    const authors = authorsByPage[page.id] ?? [];
    const roles: string[] = [];
    if (page.ownerId === outId) roles.push('page owner');
    if (page.creatorId === outId) roles.push('page creator');
    if (authors[0] === outId) roles.push('last editor');
    if (!roles.length && authors.includes(outId)) roles.push('editor');
    const touched = new Map<string, Touch>();
    for (const id of authors) {
      const p = people.get(id);
      if (p && id !== outId && !touched.has(id)) touched.set(id, { ...p, how: `edited "${page.title}"` });
      const bySpace = edits.get(page.space.id) ?? new Map<string, number>();
      if (id !== outId) bySpace.set(id, (bySpace.get(id) ?? 0) + 1);
      edits.set(page.space.id, bySpace);
    }
    if (!roles.length) continue;
    const item: WorkItem = {
      id: `conf:${page.id}`,
      kind: 'page',
      title: page.title,
      url: page.url,
      container: page.space,
      roles,
      sources: ['confluence'],
      touchedBy: [...touched.values()],
    };
    if (page.updatedAt) item.updatedAt = page.updatedAt;
    items.push(item);
  }
  const names = new Map(pages.map((p) => [p.space.id, p.space.name]));
  const peers: Record<string, { person: Person; note: string }[]> = {};
  for (const [spaceId, byPerson] of edits) {
    const list = [...byPerson.entries()]
      .map(([id, n]) => ({ person: people.get(id), n }))
      .filter((e): e is { person: Person; n: number } => !!e.person)
      .sort((a, b) => b.n - a.n)
      .map((e) => ({ person: e.person, note: `edited ${e.n} page${e.n === 1 ? '' : 's'} in ${names.get(spaceId)}` }));
    if (list.length) peers[spaceId] = list;
  }
  return { items, peers };
}

export async function lookupPeople(jira: Rest, ids: string[]): Promise<Map<string, Person>> {
  const out = new Map<string, Person>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const json = await getJson(jira, `/rest/api/3/user/bulk?${q({ accountId: batch, maxResults: 50 })}`);
    for (const u of json.values ?? []) {
      const p = toPerson(u);
      if (p) out.set(p.accountId, p);
    }
  }
  return out;
}

export async function confluenceSignals(conf: Rest, jira: Rest, siteUrl: string, outId: string) {
  const id = outId.replace(/"/g, '');
  const cql = `type=page and (creator="${id}" or contributor="${id}") order by lastmodified desc`;
  const search = await getJson(conf, `/wiki/rest/api/search?${q({ cql, limit: 25, expand: 'content.space,content.version,content.history' })}`);
  const pages = parseSearch(search, siteUrl);
  const warnings: string[] = [];
  if (search._links?.next) warnings.push('additional matching pages were not read');
  if (!pages.length) return { items: [], peers: {}, pageCount: 0, warnings };
  const [meta, ...versions] = await Promise.allSettled([
    getJson(conf, `/wiki/api/v2/pages?${q({ id: pages.map((p) => p.id), limit: 25 })}`),
    ...pages.map((p) => getJson(conf, `/wiki/api/v2/pages/${p.id}/versions?limit=25`)),
  ]);
  if (meta.status === 'rejected') warnings.push('page ownership lookup unavailable');
  else if (meta.value._links?.next) warnings.push('additional page ownership was not read');
  const ownership = meta.status === 'fulfilled' ? meta.value.results ?? [] : [];
  const owners = new Map<string, string>(ownership.map((m: Json) => [String(m.id), m.ownerId]));
  for (const p of pages) {
    const owner = owners.get(p.id);
    if (owner) p.ownerId = owner;
  }
  const authorsByPage: Record<string, string[]> = {};
  pages.forEach((p, i) => {
    const version = versions[i];
    if (version?.status === 'fulfilled')
      authorsByPage[p.id] = (version.value.results ?? []).map((v: Json) => v.authorId).filter(Boolean);
  });
  const failedHistories = versions.filter((version) => version.status === 'rejected').length;
  if (failedHistories) warnings.push(`version history unavailable for ${failedHistories} of ${pages.length} pages`);
  if (versions.some((version) => version.status === 'fulfilled' && version.value._links?.next))
    warnings.push('additional version history was not read');
  const ids = [...new Set(Object.values(authorsByPage).flat())];
  const people = await lookupPeople(jira, ids).catch(() => {
    warnings.push('author lookup unavailable');
    return new Map<string, Person>();
  });
  return { ...buildPages(pages, authorsByPage, people, outId), pageCount: pages.length, warnings };
}

export async function listSpaces(conf: Rest): Promise<{ id: string; key: string; name: string }[]> {
  const spaces: { id: string; key: string; name: string }[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const params = { limit: 100, status: 'current', ...(cursor ? { cursor } : {}) };
    const page = await getJson(conf, `/wiki/api/v2/spaces?${q(params)}`);
    for (const space of page.results ?? []) {
      spaces.push({ id: String(space.id), key: space.key, name: space.name });
    }
    const next = page._links?.next;
    cursor = next ? new URL(next, 'https://confluence.invalid').searchParams.get('cursor') : null;
    if (next && (!cursor || cursors.has(cursor))) throw new Error('Confluence space pagination did not advance');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return spaces;
}

/** Creates the handover as a draft page, so nothing is published until someone reviews it in Confluence. */
export async function createDraft(conf: Rest, siteUrl: string, spaceId: string, title: string, storage: string): Promise<{ id: string; url: string }> {
  const res = await conf('/wiki/api/v2/pages', {
    method: 'POST',
    body: JSON.stringify({ spaceId, status: 'draft', title, body: { representation: 'storage', value: storage } }),
  });
  if (!res.ok) throw new Error(`Confluence refused the draft (${res.status})`);
  const json = await res.json();
  const id = String(json.id);
  const base = json._links?.base || `${siteUrl}/wiki`;
  const path = json._links?.editui || json._links?.webui || `/pages/resumedraft.action?draftId=${encodeURIComponent(id)}`;
  return { id, url: `${base}${path}` };
}
