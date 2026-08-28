import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import type { ColumnDescriptor } from "./KanbanColumn.tsx";

/**
 * Places each quest of a board into the column that should hold it.
 *
 * Extracted from `KanbanBoard`'s render so the placement rules can be
 * asserted directly: they encode a lifecycle, and getting one wrong moves a
 * card under the user rather than throwing.
 *
 * Since quest #1227 the frame is not `New | subs | Completed` any more — a
 * project can name its own columns and say which lifecycle state each one
 * collapses to, including two done-ish ones. So the rule generalized: a
 * quest belongs to the column that both matches its STATUS and is named by
 * its `kanbanColumn`, falling back to the first column carrying that
 * status. The lifecycle triple is still the truth; columns only map onto
 * it.
 */
export class KanbanGrouping {
  /**
   * Returns one bucket per descriptor, keyed by `ColumnDescriptor.key`.
   * Every descriptor gets an entry, so a column with nothing in it still
   * renders its header and its count.
   */
  group(
    quests: QuestResource[],
    columns: ColumnDescriptor[],
  ): Record<string, QuestResource[]> {
    const byKey: Record<string, QuestResource[]> = {};
    for (const col of columns) byKey[col.key] = [];

    for (const quest of quests) {
      const status = quest.metadata.status;

      // Shelving means "I am not doing this", so the card leaves the board
      // rather than falling through to a fallback below — which read as the
      // card moving *forward* into In progress. `getBoard` already filters
      // `shelvedAt IS NULL`, so this only has to agree with the server for
      // the window between the mutation and the next load.
      if (status === "shelved") continue;

      const candidates = columns.filter((col) => col.kind === status);
      if (candidates.length === 0) continue;

      // The named column when it still exists and still carries this
      // status; otherwise the first lane that does. A quest whose column
      // was renamed or deleted lands somewhere visible rather than being
      // lost off the board.
      const home =
        candidates.find((col) => col.subColumn === quest.kanbanColumn) ??
        candidates[0];

      byKey[home.key]?.push(quest);
    }

    // Most-recently-touched first in a done column, so it reads as a log of
    // what was finished rather than whatever order the server returned.
    for (const col of columns) {
      if (col.kind !== "completed") continue;
      byKey[col.key]?.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    }

    return byKey;
  }
}
