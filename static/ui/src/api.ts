import { invoke as raw, router, view } from '@forge/bridge';
import type { Drill, IssueCover, Person } from '../../../src/core/model';

const invoke = <T>(name: string, payload?: Record<string, unknown>) => raw(name, payload) as Promise<T>;

export type Space = { id: string; key: string; name: string };
export type Receipt = { key: string; to: Person; ok: boolean; error?: string };
export type Window = { from: string; to: string };

let site: Promise<string> | undefined;
/** The Jira global page, from this module's id: ari:cloud:ecosystem::extension/<app>/<env>/static/<key>. */
export const fullDrillPath = () =>
  view.getContext().then((c) => {
    const m = /extension\/([^/]+)\/([^/]+)\//.exec(String((c as { localId?: string }).localId ?? ''));
    return m ? `/jira/apps/${m[1]}/${m[2]}` : null;
  });

export const siteUrl = () => (site ??= view.getContext()
  .then((c) => String((c as { siteUrl?: string }).siteUrl ?? ''))
  .catch((error: unknown) => {
    site = undefined;
    throw error;
  }));

export const api = {
  me: () => invoke<Person | null>('me'),
  people: (query: string) => invoke<Person[]>('people', { query }),
  drill: async (accountId: string, w: Window) => invoke<Drill>('drill', { accountId, ...w, siteUrl: await siteUrl() }),
  issue: async (w: Window) => invoke<IssueCover>('issue', { ...w, siteUrl: await siteUrl() }),
  spaces: () => invoke<Space[]>('spaces'),
  handover: async (accountId: string, w: Window, spaceId: string, reviewedBackups: Record<string, string | null>) =>
    invoke<{ id: string; url: string }>('handover', { accountId, ...w, siteUrl: await siteUrl(), spaceId, reviewedBackups, confirmed: true }),
  reassign: (changes: { key: string; to: Person }[]) => invoke<Receipt[]>('reassign', { changes, confirmed: true }),
  open: (url: string) => router.open(url),
  go: (path: string) => router.navigate(path),
};
