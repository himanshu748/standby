# Standby — Devpost draft

**Tagline:** If this person is out, what stalls? A one-click bus-factor drill for Jira and Confluence.

**Category:** Apps for Business Teams · **Bonus:** Teamwork Graph

## Inspiration
Every team has someone whose week off quietly freezes three projects. Leave planning lives in calendars, but the real risk lives in Jira assignees, Confluence page owners and project leads that nobody else has touched. We wanted a fire drill you can run before the out-of-office goes on, not after the escalation.

## What it does
Pick a teammate and the days they will be away. Standby walks their neighbourhood in Teamwork Graph (every page, post, work item, project and goal linked to them, plus their teams), adds what Jira and Confluence REST know, and then walks the graphs of the colleagues around them: any object that also sits in a colleague's graph counts as cover. Everything is sorted into three rings:

- **Stalls** — nobody else is on record for it.
- **Thin** — exactly one other person is.
- **Covered** — two or more others are.

Each item gets an urgency score that always shows its reasons (due while they are out, already overdue, high priority, in review, named owner), and up to three suggested backups with the reason for each: they worked on this item, they have open work in the same project or space, or they share a team. One confirmation drafts a handover page in Confluence; another reassigns the Jira issues you tick.

## How we built it
- Forge Custom UI (React + Vite) in a Jira global page and a Confluence global page, sharing one resolver.
- Jira REST (`/search/jql`, project leads, user search, assignee update), Confluence REST v1 search + v2 pages/versions, and Teamwork Graph curated queries (`atlassianUserWorkQuery` paged for the person and for up to 12 nearby colleagues, `atlassianUserInTeams`, `atlassianTeamMembers`, `atlassianUserAssignedJiraWorkItems`, `atlassianUserGoalsAndProjects`) through `requestTeamworkGraph`.
- Teamwork Graph is the coverage engine: the person's graph defines what they hold, and overlap with colleagues' graphs ("works on it too, per Teamwork Graph") is what moves an item from Stalls to Thin or Covered. REST fills in due dates, priorities and edit history the graph does not carry.
- Every call runs `asUser()`, so results respect the viewer's permissions. Each source fails independently and the UI says which one is missing instead of showing a falsely calm picture.
- A pure TypeScript engine merges the same work seen through several sources and scores it; it is covered by unit tests on trimmed real responses.

## Challenges
Teamwork Graph returns empty, successful results when a scope is missing, so a silent gap looks like "no risk". We isolate each query and surface per-source status. Coverage also has to be honest: a page edited only by its owner is a stall even if fifty people have viewed it.

## Accomplishments
It runs on a real site's data: for one teammate it walked 100 objects in their Teamwork Graph and 9 colleagues' graphs, found 49 shared-work links, and sorted 173 items into 106 stalled, 46 thin and 21 covered, with backups from people who had actually worked on them.

## What we learned
Bus factor is not a headcount; it is per item. The useful question is not "who can cover for Alana?" but "who can pick up MOBL-12?".

## What's next
Scheduled drills before planned leave, and team-level heat maps.

Not in this app: a Rovo action. `manifest.yml` has no `rovo` module (`rovo:agent`, `rovo:action`, or `rovo:skill`), and this submission is not for the Best Agents bonus. Coverage comes from the Teamwork Graph API.

## Built with
forge, jira, confluence, teamwork-graph, react, typescript, vite, vitest
