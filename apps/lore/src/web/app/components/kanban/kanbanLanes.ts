import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

export type LaneMode = "none" | "area" | "epic";

export interface KanbanLane {
  /**
   * Stable identity, and the prefix that makes each lane's column
   * droppables unique — two lanes showing "In progress" are two different
   * drop targets.
   */
  key: string;
  label: string;
  quests: QuestResource[];
  /**
   * The area's colour token, when the lane is an area. Absent otherwise.
   */
  areaName?: string;
}

/**
 * Splits a board into horizontal lanes.
 *
 * A flat board stops being readable somewhere past a hundred cards: every
 * column becomes a scroll well and the shape of the work disappears. Lanes
 * put that shape back without changing what a column means.
 */
export class KanbanLanes {
  /**
   * `epicTitles` maps epic id to its label; an epic the caller could not
   * resolve still gets a lane, titled by its number, rather than being
   * dropped — a card must never vanish because a lookup failed.
   */
  build(
    quests: QuestResource[],
    mode: LaneMode,
    epicTitles?: Map<number, string>,
  ): KanbanLane[] {
    if (mode === "none") {
      return [{ key: "", label: "", quests }];
    }

    const buckets = new Map<string, KanbanLane>();
    // Insertion order is the board's own order, so lanes appear in the
    // order their first card does rather than alphabetically — which keeps
    // whatever the sort was meaningful at the lane level too.
    for (const quest of quests) {
      const { key, label, areaName } =
        mode === "area"
          ? {
              key: `area:${quest.area || ""}`,
              label: quest.area || UNGROUPED,
              areaName: quest.area || undefined,
            }
          : {
              key: `epic:${quest.epicId ?? ""}`,
              label:
                quest.epicId == null
                  ? UNGROUPED
                  : (epicTitles?.get(quest.epicId) ?? `Epic ${quest.epicId}`),
              areaName: undefined,
            };

      const lane = buckets.get(key);
      if (lane) {
        lane.quests.push(quest);
      } else {
        buckets.set(key, { key, label, quests: [quest], areaName });
      }
    }

    // The catch-all lane sorts last wherever it appears: "no epic" is not a
    // grouping anyone is looking for, it is what is left over.
    const lanes = [...buckets.values()];
    return [
      ...lanes.filter((lane) => lane.label !== UNGROUPED),
      ...lanes.filter((lane) => lane.label === UNGROUPED),
    ];
  }
}

/**
 * The label for cards the grouping field does not answer for.
 */
export const UNGROUPED = "—";
