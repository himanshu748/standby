export type Person = { accountId: string; name: string; avatarUrl?: string };

/** A person plus how they touched an item, in words: "reported it", "edited it". */
export type Touch = Person & { how: string };

export type Source = 'jira' | 'confluence' | 'graph';

export type ItemKind = 'issue' | 'page' | 'project-lead' | 'atlas-project' | 'goal';

export type Container = { id: string; name: string };

/** One piece of work tied to the person who is out, with everyone else on record as having touched it. */
export type WorkItem = {
  id: string;
  kind: ItemKind;
  title: string;
  url: string;
  key?: string;
  container?: Container;
  status?: string;
  priority?: string;
  dueAt?: string;
  updatedAt?: string;
  /** Why the item belongs to the person: "assignee", "page owner", "project lead"... */
  roles: string[];
  sources: Source[];
  /** Other people with recorded activity on the item (edits, comments, transitions, reporting). */
  touchedBy: Touch[];
};

export type SourceStatus = { source: Source; label: string; ok: boolean; count: number; note?: string };

export type Signals = {
  person: Person;
  items: WorkItem[];
  /** People active in each container (project or space), with a note such as "4 open in Sales". */
  containerPeers: Record<string, { person: Person; note: string }[]>;
  /** People who share a team with the person, from Teamwork Graph. */
  teammates: { person: Person; team: string }[];
  sources: SourceStatus[];
};

export type Coverage = 'stalls' | 'thin' | 'covered';

export type BackupReason = { kind: 'touched' | 'peer' | 'teammate'; text: string };

export type Candidate = { person: Person; score: number; reasons: BackupReason[] };

export type AssessedItem = WorkItem & {
  coverage: Coverage;
  urgency: number;
  urgencyNotes: string[];
  backups: Candidate[];
};

export type BenchEntry = { person: Person; score: number; items: string[] };

export type Drill = {
  person: Person;
  window: { from: string; to: string };
  items: AssessedItem[];
  bench: BenchEntry[];
  counts: Record<Coverage, number>;
  sources: SourceStatus[];
};

/** What happens to one issue if its assignee is out. `person` is null for unassigned issues; `done` issues have nothing to stall. */
export type IssueCover = { person: Person | null; item: AssessedItem | null; sources: SourceStatus[]; done?: boolean };
