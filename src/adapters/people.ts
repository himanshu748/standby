import type { Person } from '../core/model';
import type { Json } from './http';

/** A real, active human account, or undefined for apps, bots and deactivated users. */
export function toPerson(u: Json): Person | undefined {
  if (!u?.accountId || (u.accountType && u.accountType !== 'atlassian') || u.active === false) return undefined;
  const name: string = u.displayName ?? u.publicName ?? u.name;
  if (!name || /\bbot\b|^former user$/i.test(name)) return undefined;
  const avatarUrl: string | undefined = u.avatarUrls?.['48x48'] ?? u.profilePicture?.path;
  return avatarUrl ? { accountId: u.accountId, name, avatarUrl } : { accountId: u.accountId, name };
}
