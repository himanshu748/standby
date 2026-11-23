# Privacy policy: Standby

Last updated: 23 November 2026.

Standby is a Forge app for Jira and Confluence. Given a teammate and the dates they will be away, it shows which of their Jira issues and Confluence pages may stall, suggests backups and, when you ask, drafts a handover page. This page describes what the app reads, what it writes and where that data goes, based on the app's manifest (`manifest.yml`) and source code in this repository.

## What the app reads

All reads are made as the signed-in user, so Jira, Confluence and Teamwork Graph only return what that user can already see.

- **Jira:** issues assigned to or reported by the selected person, their status, due date, priority, project and recent history, and the site's user directory for the people picker. Scopes: `read:jira-work`, `read:jira-user`.
- **Confluence:** pages the selected person owns or recently edited, their contributors, and the list of spaces for the handover picker. Scopes: `read:confluence-content.summary`, `read:page:confluence`, `read:space:confluence`.
- **Teamwork Graph:** the selected person's and nearby colleagues' work, teams, projects and goals, used to find who else has touched each item. Scopes: `read:graph:*`.

## What the app writes

Only after you confirm in a dialog:

- **Jira:** reassigns the issues you selected to the backup you chose. Scope: `write:jira-work`.
- **Confluence:** creates one handover page as a draft in the space you chose. Scope: `write:page:confluence`.

## What the app stores

Nothing. Standby has no app storage: each drill is computed on request and kept only in your browser tab until you close it.

## What the app does not do

- It stores no personal data.
- It contacts no external hosts: all requests go to Atlassian's own APIs.
- It has no analytics, tracking or advertising, and shares no data with third parties.
- It uses no language model.

## Logs

The app may write operational log lines to Forge logging on Atlassian's infrastructure. They contain event names and HTTP status codes, never page text, issue text or tokens.

## Contact

Questions: [open an issue](https://github.com/himanshu748/standby/issues).
