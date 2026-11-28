# Standby

**When a teammate takes leave, nobody knows which work will stall.**

<img src="docs/screenshots/02-drill.png" width="640" alt="Standby drill showing stalled, thinly covered, and covered work">

Pick a teammate and their dates away. Standby shows who can cover each item,
suggests backups with reasons, and can draft a Confluence handover or reassign
selected Jira issues after confirmation.

Open **Handover brief** after a drill to copy the work at risk, backup choices and
source coverage into a team update. The brief uses the drill already on screen.

[Run the local judge walkthrough](#local-judge-walkthrough) to try it with sample data.

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

## Local judge walkthrough

Use the interactive walkthrough to evaluate the drill without a Forge install
or an Atlassian account. From a fresh clone with Node 22 or newer, run:

```sh
npm ci
npm run demo
```

Open [http://127.0.0.1:4175](http://127.0.0.1:4175) and follow the sample:

1. Search for **Priya Shah** and set the dates to **December 8–19, 2026**. Run
   the drill and check for five stalled, three thinly covered, and one covered
   item.
2. Find **MOBL-31**, Wallet token refresh. Teamwork Graph found the same issue
   in a colleague's graph, so it lands in the thinly covered group. Open
   **Handover brief** to copy the work and backup suggestions.
3. Choose a different backup on a work card. Select **Draft handover page**,
   confirm the **Mobile checkout** space, and open the draft from the receipt.
   Find the chosen backup in the resulting table.

The app runs the same drill and draft creation logic as Forge, using fixed,
synthetic Jira, Confluence, and Teamwork Graph responses. Jira reassignment
produces a simulated receipt, and each drill starts from the same fixture. The
walkthrough makes no calls to Atlassian.

Run `npm run build:demo` to package the same synthetic walkthrough in
`dist/walkthrough`. Serve that directory over HTTP on a static host. The
packaged walkthrough runs the fixture in each visitor's browser and needs no
backend or credentials. The Forge installation link is still required to test
real Jira, Confluence and Teamwork Graph behavior.

## How it uses Atlassian

Forge hosts the Jira and Confluence app. Teamwork Graph finds the teammate's work
and colleagues who share it. Jira and Confluence REST add status, due dates, and
edit history. Queries run with the signed-in user's permissions.

## Quickstart

From a fresh clone with Node 22 or newer:

~~~sh
npm ci && npm run check
~~~

This builds the UI and runs the checks. `npm run proof` replays a six-person
drill and writes the handover draft to [proof/handover-page.html](proof/handover-page.html)
without contacting a site.

A live drill needs a Forge development install on Jira or Confluence. That path
is for contributors, not judges. See [development and setup](docs/development.md).

[Video](https://youtu.be/7HAcyNG6KVs) · [Devpost](https://devpost.com/software/standby-ng4uxi) ·
[Privacy](PRIVACY.md) · [License](LICENSE)
