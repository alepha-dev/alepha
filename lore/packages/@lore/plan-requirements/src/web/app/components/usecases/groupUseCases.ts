import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";

export type UseCaseGrouping = "epic" | "persona" | "status" | "none";

export interface UseCaseGroup {
  key: string;
  /**
   * What the group is: an epic, a persona, a status, or no grouping at all.
   */
  kind: "epic" | "persona" | "status" | "none" | "unplanned";
  label: string;
  number?: number;
  rows: UseCaseResource[];
  /**
   * The epic's quests done and total, for an epic group.
   */
  progress?: { completed: number; total: number };
}

/**
 * The Use cases tab's groups (#E153): by covering epic (the default), by
 * persona, by status, or none. A use case covered by two epics, or played
 * by two personas, appears in each of their groups; one covered by none
 * lands in "No epic yet", last.
 */
export const groupUseCases = (
  rows: UseCaseResource[],
  grouping: UseCaseGrouping,
): UseCaseGroup[] => {
  if (grouping === "none") {
    return [{ key: "all", kind: "none", label: "", rows }];
  }
  const groups = new Map<string, UseCaseGroup>();
  const add = (key: string, make: () => UseCaseGroup, row: UseCaseResource) => {
    const group = groups.get(key) ?? make();
    group.rows.push(row);
    groups.set(key, group);
  };
  const rest: UseCaseResource[] = [];
  for (const row of rows) {
    if (grouping === "status") {
      add(
        row.status,
        () => ({
          key: row.status,
          kind: "status",
          label: row.status,
          rows: [],
        }),
        row,
      );
      continue;
    }
    const owners =
      grouping === "epic"
        ? row.coveredBy.map((epic) => ({
            key: `epic:${epic.number}`,
            number: epic.number,
            label: epic.title,
            progress: epic.progress,
          }))
        : row.actors.map((actor) => ({
            key: `persona:${actor.number}`,
            number: actor.number,
            label: actor.name,
            progress: undefined,
          }));
    if (owners.length === 0) rest.push(row);
    for (const owner of owners) {
      add(
        owner.key,
        () => ({
          key: owner.key,
          kind: grouping,
          label: owner.label,
          number: owner.number,
          progress: owner.progress,
          rows: [],
        }),
        row,
      );
    }
  }
  const sorted = [...groups.values()].sort(
    (a, b) =>
      (a.number ?? 0) - (b.number ?? 0) || a.label.localeCompare(b.label),
  );
  if (rest.length) {
    sorted.push({ key: "unplanned", kind: "unplanned", label: "", rows: rest });
  }
  return sorted;
};

/**
 * The quests done and total of the epics covering a use case.
 */
export const developmentOf = (
  row: UseCaseResource,
): { completed: number; total: number } | undefined => {
  if (row.coveredBy.length === 0) return undefined;
  return row.coveredBy.reduce(
    (sum, epic) => ({
      completed: sum.completed + (epic.progress?.completed ?? 0),
      total: sum.total + (epic.progress?.total ?? 0),
    }),
    { completed: 0, total: 0 },
  );
};
