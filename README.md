# Standby

**If this person is out, what stalls?** Standby is a Forge app for Jira and Confluence that runs a bus-factor fire drill for one teammate and a date range.

1. Pick a real person on the site and the days they will be away.
2. Standby walks their Teamwork Graph neighbourhood (pages, posts, work items, projects, goals, teams), adds the Jira issues and Confluence pages REST knows about, then walks nearby colleagues' graphs: an object that sits in a colleague's graph counts as cover.
3. Every item is classed by who else is on record: **stalls** (nobody), **thin** (one other person) or **covered** (two or more), and ranked by an urgency score that is always explained (due while they are out, priority, active status, named owner).
4. For each item it suggests up to three backups, with the reason: worked on this item, has open work in the same project or space, or shares a team.
5. With an explicit confirmation it drafts a handover page in Confluence (as a draft, never published) and reassigns the Jira issues you tick.

Everything runs as the signed-in user (`api.asUser()`), so people only see work they already have permission to see. Nothing is written without a confirmation dialog.

## Layout

| Path | What it is |
| --- | --- |
| `src/core` | Pure scoring engine: coverage, urgency, backups, handover page, orbit layout. No Forge imports. |
| `src/adapters` | Jira REST, Confluence REST and Teamwork Graph curated queries, parsed into one `WorkItem` model. |
| `src/index.ts` | Forge resolvers: `people`, `drill`, `spaces`, `handover`, `reassign`. |
| `static/ui` | React + Vite Custom UI. |
| `test` | Vitest tests; fixtures are trimmed real responses from the development site. |

## Develop

```bash
npm install
npm run check            # typecheck, lint, tests, UI build
npx @forge/cli deploy -e development
npx @forge/cli install --site <site>.atlassian.net --product jira -e development
npx @forge/cli install --site <site>.atlassian.net --product confluence -e development
```

Open it from **Apps → Standby** in Jira or Confluence.
