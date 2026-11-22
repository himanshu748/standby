import type { AssessedItem, Drill } from './model';

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function handoverTitle(drill: Drill): string {
  return `Handover: ${drill.person.name}, ${drill.window.from} to ${drill.window.to}`;
}

const label = { stalls: 'Stalls without them', thin: 'One other person', covered: 'Covered' } as const;

function row(item: AssessedItem): string {
  const top = item.backups[0];
  const backup = top ? `${escapeXml(top.person.name)} (${escapeXml(top.reasons.map((r) => r.text).join('; '))})` : 'Nobody found yet';
  const name = `<a href="${escapeXml(item.url)}">${escapeXml(item.key ? `${item.key} ${item.title}` : item.title)}</a>`;
  const why = item.urgencyNotes.length ? escapeXml(item.urgencyNotes.join(', ')) : '';
  return `<tr><td>${name}</td><td>${escapeXml(item.roles.join(', '))}</td><td>${why}</td><td>${backup}</td><td></td></tr>`;
}

/** Confluence storage-format body for the handover page. The last column is left for the backup to fill in. */
export function handoverStorage(drill: Drill): string {
  const { person, counts } = drill;
  const parts: string[] = [];
  parts.push(
    `<p>${escapeXml(person.name)} is out from <strong>${escapeXml(drill.window.from)}</strong> to <strong>${escapeXml(drill.window.to)}</strong>. ` +
      `Standby found ${counts.stalls} item(s) nobody else has touched, ${counts.thin} with one other person and ${counts.covered} already covered.</p>`,
  );
  const bench = drill.bench.slice(0, 5);
  if (bench.length) {
    parts.push('<h2>Suggested backups</h2><ul>');
    for (const b of bench) parts.push(`<li><strong>${escapeXml(b.person.name)}</strong>: ${b.items.length} item(s)</li>`);
    parts.push('</ul>');
  }
  for (const coverage of ['stalls', 'thin', 'covered'] as const) {
    const items = drill.items.filter((i) => i.coverage === coverage);
    if (!items.length) continue;
    parts.push(`<h2>${label[coverage]} (${items.length})</h2>`);
    parts.push('<table><tbody><tr><th>Work</th><th>Their role</th><th>Why it matters</th><th>Suggested backup</th><th>Notes from the backup</th></tr>');
    parts.push(...items.map(row));
    parts.push('</tbody></table>');
  }
  parts.push('<h2>Before they leave</h2><ul><li>Walk each backup through the items above.</li><li>Share access the backup does not have yet.</li><li>Agree who decides if something new comes up.</li></ul>');
  return parts.join('');
}
