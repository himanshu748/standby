import type { AssessedItem, Drill } from "./model";

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function handoverTitle(drill: Drill): string {
  return `Handover: ${drill.person.name}, ${drill.window.from} to ${drill.window.to}`;
}

const label = {
  stalls: "Stalls without them",
  thin: "One other person",
  covered: "Covered",
} as const;

const chosen = (item: AssessedItem, picked?: string) =>
  item.backups.find((b) => b.person.accountId === picked) ?? item.backups[0];

function sourceStatus(source: Drill["sources"][number]): string {
  const count = `${source.count} ${source.count === 1 ? "item" : "items"}`;
  return source.ok ? count : `partial (${count} found)`;
}

/** Plain text for sharing the completed drill. */
export function handoverBrief(drill: Drill, picks: Record<string, string>): string {
  const parts = [handoverTitle(drill), "", "Source coverage"];
  for (const source of drill.sources) {
    parts.push(`- ${source.label}: ${sourceStatus(source)}${source.note ? ` (${source.note})` : ""}`);
  }
  for (const coverage of ["stalls", "thin", "covered"] as const) {
    const items = drill.items.filter((item) => item.coverage === coverage);
    if (!items.length) continue;
    parts.push("", `${label[coverage]} (${items.length})`);
    for (const item of items) {
      const top = chosen(item, picks[item.id]);
      const name = item.key ? `${item.key} ${item.title}` : item.title;
      const reason = top?.reasons.map((evidence) => evidence.text).join("; ");
      const backup = top ? `${top.person.name}${reason ? ` (${reason})` : ""}` : "Nobody found in this drill";
      parts.push(`- ${name} | ${item.url}`, `  Suggested backup: ${backup}`);
      if (item.urgencyNotes.length) parts.push(`  ${item.urgencyNotes.join("; ")}`);
    }
  }
  return parts.join("\n");
}

function row(item: AssessedItem, picked?: string): string {
  const top = chosen(item, picked);
  const backup = top
    ? `${escapeXml(top.person.name)} (${escapeXml(top.reasons.map((r) => r.text).join("; "))})`
    : "Nobody found yet";
  const name = `<a href="${escapeXml(item.url)}">${escapeXml(item.key ? `${item.key} ${item.title}` : item.title)}</a>`;
  const why = item.urgencyNotes.length
    ? escapeXml(item.urgencyNotes.join(", "))
    : "";
  return `<tr><td>${name}</td><td>${escapeXml(item.roles.join(", "))}</td><td>${why}</td><td>${backup}</td><td></td></tr>`;
}

/** Confluence storage-format body for the handover page. The last column is left for the backup to fill in. */
export function handoverStorage(
  drill: Drill,
  picks: Record<string, string> = {},
): string {
  const { person, counts } = drill;
  const parts: string[] = [];
  parts.push(
    `<p>${escapeXml(person.name)} is out from <strong>${escapeXml(drill.window.from)}</strong> to <strong>${escapeXml(drill.window.to)}</strong>. ` +
      `Standby found ${counts.stalls} item(s) with no other recorded contributor, ${counts.thin} with one and ${counts.covered} with more than one.</p>`,
  );
  if (drill.sources.length) {
    parts.push("<h2>Source coverage</h2>");
    if (drill.sources.some((source) => !source.ok)) {
      parts.push("<p>Source coverage is incomplete. Check the missing evidence before relying on these results.</p>");
    }
    parts.push("<ul>");
    for (const source of drill.sources) {
      parts.push(`<li>${escapeXml(source.label)}: ${sourceStatus(source)}</li>`);
    }
    parts.push("</ul>");
  }
  const bench = new Map<string, { name: string; n: number }>();
  for (const i of drill.items) {
    if (i.coverage === "covered") continue;
    const b = chosen(i, picks[i.id]);
    if (!b) continue;
    const e = bench.get(b.person.accountId) ?? { name: b.person.name, n: 0 };
    e.n += 1;
    bench.set(b.person.accountId, e);
  }
  const top = [...bench.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  if (top.length) {
    parts.push("<h2>Suggested backups</h2><ul>");
    for (const b of top)
      parts.push(
        `<li><strong>${escapeXml(b.name)}</strong>: ${b.n} item(s)</li>`,
      );
    parts.push("</ul>");
  }
  for (const coverage of ["stalls", "thin", "covered"] as const) {
    const items = drill.items.filter((i) => i.coverage === coverage);
    if (!items.length) continue;
    parts.push(`<h2>${label[coverage]} (${items.length})</h2>`);
    parts.push(
      "<table><tbody><tr><th>Work</th><th>Their role</th><th>Why it matters</th><th>Suggested backup</th><th>Notes from the backup</th></tr>",
    );
    parts.push(...items.map((i) => row(i, picks[i.id])));
    parts.push("</tbody></table>");
  }
  parts.push(
    "<h2>Before they leave</h2><ul><li>Walk each backup through the items above.</li><li>Share access the backup does not have yet.</li><li>Agree who decides if something new comes up.</li></ul>",
  );
  return parts.join("");
}
