# Standby

**When a teammate takes leave, nobody knows which work will stall.**

<img src="docs/screenshots/02-drill.png" width="640" alt="Standby drill showing stalled, thinly covered, and covered work">

Pick a teammate and their dates away. Standby shows who can cover each item,
suggests backups with reasons, and can draft a Confluence handover or reassign
selected Jira issues after confirmation.

Open **Handover brief** after a drill to copy the work at risk, backup choices and
source coverage into a team update. The brief uses the drill already on screen.

[Install on a Jira and Confluence test site](#installation-link) · [Teamwork Graph check](#teamwork-graph-check) · [Run the local fixture](#local-judge-walkthrough) · [Watch the demo](https://youtu.be/7HAcyNG6KVs)

## Prerequisites

Judges need an Atlassian Cloud site with all three:

1. **Jira.** Standby reads issues assigned to the person, project leads, and who else has open work in those projects. After a second confirmation it can reassign the issues you tick.
2. **Confluence.** Standby reads pages they own or edited, and creates the handover as a draft in a space you choose.
3. **Teamwork Graph API.** Native shared-work verification needs a site and test accounts with access to the API and shared data. Coverage uses `requestTeamworkGraph` and the `read:graph:*` scopes in `manifest.yml`. If Graph is unavailable or incomplete, the drill still runs with the other available sources and marks Teamwork Graph as partial.

Install the app on **both** Jira and Confluence. The global page is on both products, the issue panel is on Jira issues, and the handover draft is a Confluence page. A site admin opens the installation link. No Forge CLI and no clone are required for that.

There is no Rovo module in `manifest.yml`. Standby is not a Rovo agent and is not entered for the Best Agents bonus.

## Installation link

[Install Standby for Jira and Confluence](https://developer.atlassian.com/console/install/689d38fb-0df1-46ef-8f81-be74c1ad79c2?signature=AYABeODMtVXMyXPlF3vNvnFaXA0AAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBJc43aUe2NCFJUvwM7VQ9NAAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDPCaQneI%2BRnxw12ozwIBEIA7wIvHGKlUh9yrpyEKa4Q0CExBlkilbNeQTInIOAT8sE6VVnPN3rKq2XqVMnB1VmhyT7ijCZHMMT0W3Q8AB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgGXZd9RFwVr8e3MGdJ9W7FqAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMY5fOfPvDHeQ2TgWAAgEQgDs5%2FcOiEC4ywYKaNrSZ45p7DiHSmdu97PzStDkTc11RRHVadMgLeFphB2VSvAjAD%2BdzlYFqAp4Vdlu3ngAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEARPEWXVVpaF%2BXwjsmLHLJ1AAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAyBXPFlCna8kwRaWiICARCAO6oAWWUqYS1MYBO3SZSL25tK%2FnRuSWCXH8Mfnu0ic%2FsQpQadZHuyVQETQ%2Ftpdlp3EKga2JMq0pUO%2FiqeAgAAAAAMAAAQAAAAAAAAAAAAAAAAAJiSs1HQp1%2BY4fFIxJs6Mzr%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADJSeh94sXy8pEzJaw0cGoQ6riQ9qADcYrOnZmnWVHAmxyInnLX8MupLJCIn9UZ5Mkd%2FlNRW05fxNtqsdaGZGMg87UM%3D&product=confluence&product=jira)

1. Sign in as a site admin and choose an Atlassian Cloud test site that has Jira and Confluence. Complete installation for both products and check that Standby appears under **Connected apps**.
2. Open **Standby** from the apps menu. Choose a teammate who owns test work, enter the dates they are away, and select **Run the drill**. Review the coverage groups and source status.
3. Open a Jira issue assigned to that teammate and select the **Standby** issue panel to check coverage for that issue.
4. In the drill, select **Draft handover page**, choose a Confluence space where you can create pages, and confirm. Open the resulting private draft to inspect the handover.

[Read the native judge test results](docs/evidence/forge-judge-run.md). The recorded run confirmed the two-product installation, the absence drill, the Jira panel and a private handover draft. It found no backup candidates in that test data.

## Teamwork Graph check

1. On a test site, pick a teammate with open work and a colleague whose Graph work also includes a test item. Run the drill as a user who can see that work.
2. In **Where this came from**, check the **Teamwork Graph** row for shared objects in colleagues' graphs. On the affected card, look for the backup reason “works on it too, per Teamwork Graph.” Record the item and source detail if it appears.
3. If Graph is partial, read the source detail for missing or capped results. Jira and Confluence can still contribute. A zero count on incomplete Graph data does not establish that nobody can cover the work.

Standby consumes Teamwork Graph through signed-in-user GraphQL queries. That is the integration for the [Codegeist Teamwork Graph bonus](https://codegeist2026.devpost.com/rules). The [development evidence](docs/development.md#demo-evidence) records shared work in an earlier native drill. For a predictable offline comparison, the synthetic walkthrough below shows the same backup reason on **MOBL-31** without calling Graph.

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

For a native judge run, use the [installation link](#installation-link).
Contributors can use the Forge CLI via the [development guide](docs/development.md).

[Video](https://youtu.be/7HAcyNG6KVs) · [Devpost](https://devpost.com/software/standby-ng4uxi) ·
[Privacy](PRIVACY.md) · [License](LICENSE)
