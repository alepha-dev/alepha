import { type Infer, z } from "alepha";

const questRef = z.object({
  shortId: z.integer(),
  title: z.string(),
});

const composition = z.array(
  z.object({
    value: z.string(),
    todo: z.integer(),
    inProgress: z.integer(),
    onHold: z.integer(),
  }),
);

/**
 * The Reports Backlog tab (#Q3002): the open work as it stands.
 */
export const reportsBacklogSchema = z.object({
  open: z.integer(),
  /**
   * Every value of each axis, biggest first, stacked by state. A quest counts
   * once per tag it holds, so the tag rows overlap.
   */
  byArea: composition,
  byTag: composition,
  byPriority: composition,
  bySize: composition,
  /**
   * Open quests by time since created. Bucket keys are named by the locale:
   * `reports.backlog.age.<key>`.
   */
  age: z.array(z.object({ key: z.text(), count: z.integer() })),
  /**
   * Open quests held up by another open quest, grouped by the one at the head
   * of the chain.
   */
  blocked: z.array(
    z.object({
      blocker: questRef,
      blocked: z.array(questRef),
      depth: z.integer(),
    }),
  ),
  held: z.array(
    questRef.extend({
      heldBy: z.string().optional(),
      heldDays: z.number(),
    }),
  ),
  /**
   * Quests shelved over every quest of the project.
   */
  shelvedRate: z.number(),
  overdue: z.array(questRef.extend({ days: z.number() })),
  dueSoon: z.array(questRef.extend({ days: z.number() })),
  /**
   * Open quests with no objectives, or with an empty description.
   */
  hygiene: z.array(
    questRef.extend({
      noObjectives: z.boolean(),
      noDescription: z.boolean(),
    }),
  ),
  /**
   * Objectives of the quests completed in the period.
   */
  objectives: z.object({
    completed: z.integer(),
    waived: z.integer(),
  }),
});

export type ReportsBacklog = Infer<typeof reportsBacklogSchema>;
