# Standby development

Use Node 22 or newer. Run `npm ci && npm run check` for types, lint, tests and a UI build.

## Install for development

Sign in to the Atlassian Forge CLI, then deploy to your development environment.
Install on a site where you have permission to manage apps. Omit the install
command for any product your site does not use.

~~~sh
npx @forge/cli deploy -e development
npx @forge/cli install --site <site>.atlassian.net --product jira -e development
npx @forge/cli install --site <site>.atlassian.net --product confluence -e development
~~~

Open **Apps → Standby**, choose a teammate and date range, and run a drill.

## How coverage works

[Adapters](../src/adapters) call Teamwork Graph through `requestTeamworkGraph`.
The teammate's graph defines their work, and overlap with colleagues' graphs is
evidence of coverage. Curated person, work, team and goal queries combine with
Jira REST and Confluence REST. A source can fail independently, and the UI shows
which data was unavailable.

[The scoring engine](../src/core) ranks items using due dates and active status,
labels coverage, and explains each suggested backup. [Forge resolvers](../src/index.ts)
serve [the UI](../static/ui) and handle the confirmed handover and reassign actions.
[Tests](../test) include trimmed responses from the development site.

## Demo evidence

In a recorded development-site drill, Standby read 100 Teamwork Graph objects for
the selected teammate, queried nine colleagues' graphs, and found 49 shared-work
links. The combined graph and REST data yielded 173 items: 106 stalled, 46 thin,
and 21 covered. See the [drill screens](screenshots) and
[recorded demo](https://youtu.be/7HAcyNG6KVs).
