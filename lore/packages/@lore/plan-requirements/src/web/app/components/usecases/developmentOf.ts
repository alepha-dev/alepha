import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";

/**
 * A use case's development (#E153): the quests done and in all across the
 * epics covering it, or `undefined` while no epic covers it.
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
