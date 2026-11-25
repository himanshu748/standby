# Standby

**If this person is out, what stalls?** Standby is a Forge app for Jira and Confluence. Pick a teammate and the days they are away. It sorts their work into three rings, names a backup for each item, and on confirmation creates a Confluence handover draft.

| Ring | Meaning |
| --- | --- |
| Stalls | Nobody else is on record for that item. |
| Thin | One other person is. |
| Covered | Two or more other people are. |

Teamwork Graph decides the rings. An object that also sits in a colleague's graph counts as cover, even when the Jira changelog never mentions them. Jira and Confluence REST add due dates, priority, and edit history. Every read and write runs as the signed-in user. Nothing is written until you confirm it, and the handover page is created as a draft.

## Prerequisites

Judges need an Atlassian Cloud site with all three:

1. **Jira.** Standby reads issues assigned to the person, project leads, and who else has open work in those projects. After a second confirmation it can reassign the issues you tick.
2. **Confluence.** Standby reads pages they own or edited, and creates the handover as a draft in a space you choose.
3. **Teamwork Graph API.** Coverage uses `requestTeamworkGraph` and the `read:graph:*` scopes in `manifest.yml`. Codegeist judge sites include this API. If a site does not, the drill still runs and marks Teamwork Graph as partial. It does not treat that silence as "nothing stalls".

Install the app on **both** Jira and Confluence. The global page is on both products, the issue panel is on Jira issues, and the handover draft is a Confluence page. A site admin opens the installation link. No Forge CLI and no clone are required for that.

There is no Rovo module in `manifest.yml`. Standby is not a Rovo agent and is not entered for the Best Agents bonus.

## Installation link

Judges install from the link below. The line in the box is a placeholder, not a working link.

```
PASTE_THE_SIGNED_INSTALL_LINK_HERE
```

Replace that placeholder with the installation link from the Forge developer console. A `forge install` command is not a substitute: it only works for contributors of the app.

### How the owner creates the link

This repository cannot mint the link. The app owner does it once, in the Forge developer console, after a production deploy. Atlassian documents the same flow as [Start sharing your app](https://developer.atlassian.com/platform/forge/distribute-your-apps/).

1. From a checkout of this repo, signed in to the Forge CLI as the app owner, deploy production. The development environment has no judge link.

   ```bash
   npx @forge/cli deploy -e production
   ```

2. Open [developer.atlassian.com/console/myapps](https://developer.atlassian.com/console/myapps/) and select this app. The id in `manifest.yml` is `ari:cloud:ecosystem::app/689d38fb-0df1-46ef-8f81-be74c1ad79c2`.
3. In the left menu, select **Distribution**. Under **Distribution controls**, select **Edit**. This is **Start sharing your app**.
4. Select **Sharing**. Do not select **Sharing within organization**. That option only works for people in the app owner's organizations, and judges are outside them. Fill in the listing. The privacy policy text is [PRIVACY.md](PRIVACY.md). If the form asks for a URL, use the public URL of that file. Save changes.
5. Select **Jira** and **Confluence**. The console then requires a site that runs both. The installing admin opens the same link twice: once to install on Jira, once to install on Confluence.
6. Copy the installation link shown on the Distribution page.

Paste that URL in both of these places:

- In this README, replace the single line `PASTE_THE_SIGNED_INSTALL_LINK_HERE`.
- In the Devpost submission, paste it into the installation link field, and select the **Best apps with Teamwork Graph integration** bonus. Do not select Best Agents.

Until the placeholder is replaced, judges cannot install Standby.

## What to try

1. In Jira or Confluence, open **Apps → Standby**.
2. Pick someone who owns work other people have not touched, and set the days they are away.
3. Read the orbit. Stalls sit on the outer ring. Hover or tab to a dot to name the item.
4. Tick backups on the items that should move, choose a space, and confirm **Draft handover page**.
5. Open the draft in Confluence. It is not published.
6. On a Jira issue, the Standby panel answers the same question for that one issue.

## Proof without a site

`npm run proof` replays a six-person checkout team from [test/fixtures/seed-team.json](test/fixtures/seed-team.json). Priya Shah is out 8–19 December 2026. The run prints every ring, including the wallet issue that only moves off "stalls" because it sits in a colleague's Teamwork Graph, and it writes the draft handover to [proof/handover-page.html](proof/handover-page.html). No Atlassian site is contacted.

```bash
npm ci
npm run proof
```

Node 22 or newer. `npm run check` is typecheck, lint, tests, and the UI build.

## Develop from source

This path is for contributors. It is not the judge install.

```bash
npm ci
npm run check
npx @forge/cli deploy -e development
npx @forge/cli install --site <site>.atlassian.net --product jira -e development
npx @forge/cli install --site <site>.atlassian.net --product confluence -e development
```

Open **Apps → Standby** in Jira or Confluence.

| Path | What it is |
| --- | --- |
| `src/core` | Scoring: coverage, urgency, backups, the handover page, the orbit layout. No Forge imports. |
| `src/adapters` | Jira REST, Confluence REST, and Teamwork Graph queries. |
| `src/index.ts` | Forge resolvers: `people`, `drill`, `issue`, `spaces`, `handover`, `reassign`. |
| `static/ui` | React Custom UI. |
| `test` | Vitest. `test/fixtures/seed-team.json` is the multi-user drill. |

License: [MIT](LICENSE). Privacy: [PRIVACY.md](PRIVACY.md).
