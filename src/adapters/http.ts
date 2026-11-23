/* eslint-disable @typescript-eslint/no-explicit-any -- product APIs return loosely typed JSON; parsers narrow it. */
export type Json = any;

export type Res = { ok: boolean; status: number; json(): Promise<Json> };

/** A product REST call made as the signed-in user (path is already encoded). */
export type Rest = (path: string, init?: { method?: string; body?: string }) => Promise<Res>;

/** A Teamwork Graph GraphQL call made as the signed-in user. */
export type Graph = (query: string, variables: Record<string, unknown>) => Promise<{ data?: Json; errors?: { message: string }[] }>;

export async function getJson(rest: Rest, path: string): Promise<Json> {
  const res = await rest(path);
  if (!res.ok) throw new Error(`${path.split('?')[0]} returned ${res.status}`);
  return res.json();
}

export const q = (params: Record<string, string | number | string[]>): string =>
  Object.entries(params)
    .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}=${encodeURIComponent(String(x))}`))
    .join('&');
