# Native Forge judge run

On 28 November 2026, an administrator installed the public production build of Standby, version 2.3.0, on Jira and Confluence in an Atlassian Cloud judge test site. The run used test data on that site. Names and tenant details are omitted.

| Check | Observed result | Capture |
| --- | --- | --- |
| Initial absence drill | Standby showed 9 items in **Stalls**, 0 in **Thin**, and 0 in **Covered**. It proposed no backups for this test data. | |
| Confluence handover | Standby created a private handover draft in the selected test space. The draft opened and remained unpublished. | [Draft editor](handover-draft.jpg) |
| Jira issue panel | After assigning synthetic issue `KAN-2` to the test teammate, the panel showed **Stalls**, 0 other people on record and 0 suggested backups. It listed Jira and Teamwork Graph as sources. | [Issue panel](issue-panel.jpg) |
| Follow-up absence drill | With `KAN-2` assigned, Standby showed 10 items in **Stalls**, 0 in **Thin**, and 0 in **Covered**. | [Drill results](drill.jpg) |

The captures are cropped to the relevant controls and results. The account name and avatar are masked where they appeared.

The [local judge walkthrough](../../README.md#local-judge-walkthrough) uses a separate synthetic dataset to demonstrate how Standby presents and preserves backup choices when there are candidates.
