import { listSpaces } from '../adapters/confluence';
import { createHandover, drill, reassignIssues } from '../service';
import { draftFromCalls, proofHtml } from './draft';
import { clientsFromSeed, type Seed } from './world';

/** Every request uses fresh fixture clients. The walkthrough always starts with the same sample data. */
export function walkthrough(seed: Seed) {
  const person = seed.people.find((p) => p.accountId === seed.out)!;
  const sample = { person, window: seed.window };

  function input(payload: unknown) {
    const fields = payload as Parameters<typeof drill>[0];
    if (fields.accountId !== person.accountId) throw new Error(`Choose ${person.name} for this sample drill.`);
    return { ...fields, siteUrl: seed.site };
  }

  async function invoke(name: string, payload: unknown): Promise<unknown> {
    const clients = clientsFromSeed(seed);
    switch (name) {
      case 'context':
        return { moduleKey: 'standby-global', siteUrl: seed.site };
      case 'people': {
        const query = (payload as { query: string }).query.trim().toLowerCase();
        return query.length >= 2 && person.name.toLowerCase().includes(query) ? [person] : [];
      }
      case 'spaces':
        return listSpaces(clients.conf);
      case 'drill':
        return drill(input(payload), clients);
      case 'handover': {
        const { confirmed, picks, spaceId } = payload as Parameters<typeof createHandover>[0];
        if (spaceId !== seed.handoverSpaceId) throw new Error('Choose the sample handover space.');
        const { page } = await createHandover({ ...input(payload), confirmed, spaceId, ...(picks ? { picks } : {}) }, clients);
        return { id: page.id, html: proofHtml(draftFromCalls(clients.calls), page.url, true) };
      }
      case 'reassign':
        return reassignIssues(payload as Parameters<typeof reassignIssues>[0], clients.jira);
      default:
        throw new Error(`Unknown walkthrough action: ${name}`);
    }
  }

  return { sample, invoke };
}
