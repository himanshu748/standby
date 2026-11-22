# Standby — Devpost draft

**Tagline:** If this person is out, what stalls? A one-click bus-factor drill for Jira and Confluence.

**Category:** Apps for Business Teams · **Bonus:** Teamwork Graph

## Inspiration
Every team has someone whose week off quietly freezes three projects. Leave planning lives in calendars, but the real risk lives in Jira assignees, Confluence page owners and project leads that nobody else has touched. We wanted a fire drill you can run before the out-of-office goes on, not after the escalation.

## What it does
Pick a teammate and the days they will be away. Standby gathers everything they hold across Jira and Confluence, plus their teams, Atlassian projects and goals from Teamwork Graph, and sorts it into three rings:

- **Stalls** — nobody else is on record for it.
- **Thin** — exactly one other person is.
- **Covered** — two or more others are.

Each item gets an urgency score that always shows its reasons (due while they are out, already overdue, high priority, in review, named owner), and up to three suggested backups with the reason for each: they worked on this item, they have open work in the same project or space, or they share a team. One confirmation drafts a handover page in Confluence; another reassigns the Jira issues you tick.

## How we built it
- Forge Custom UI (React + Vite) in a Jira global page and a Confluence global page, sharing one resolver.
- Jira REST (`/search/jql`, project leads, user search, assignee update), Confluence REST v1 search + v2 pages/versions, and Teamwork Graph curated queries (`atlassianUserInTeams`, `atlassianTeamMembers`, `atlassianUserAssignedJiraWorkItems`, `atlassianUserContent`, `atlassianUserGoalsAndProjects`) through `requestTeamworkGraph`.
- Every call runs `asUser()`, so results respect the viewer's permissions. Each source fails independently and the UI says which one is missing instead of showing a falsely calm picture.
- A pure TypeScript engine merges the same work seen through several sources and scores it; it is covered by unit tests on trimmed real responses.

## Challenges
Teamwork Graph returns empty, successful results when a scope is missing, so a silent gap looks like "no risk". We isolate each query and surface per-source status. Coverage also has to be honest: a page edited only by its owner is a stall even if fifty people have viewed it.

## Accomplishments
It runs on a real site's data: for one teammate it found 39 stalled, 41 thin and 7 covered items across 8 Jira projects and Confluence, and proposed backups from people who had actually worked in those projects.

## What we learned
Bus factor is not a headcount; it is per item. The useful question is not "who can cover for Alana?" but "who can pick up MOBL-12?".

## What's next
Scheduled drills before planned leave, a Rovo action to run a drill from chat, and team-level heat maps.

## Built with
forge, jira, confluence, teamwork-graph, react, typescript, vite, vitest
