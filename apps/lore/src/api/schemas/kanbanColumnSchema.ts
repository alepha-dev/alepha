import { type Infer, z } from "alepha";

/**
 * Per-column board settings, keyed by the column's name.
 *
 * **The lifecycle triple stays the truth.** `status` is what a column
 * COLLAPSES TO, not a status of its own: quests, milestones, reports, MCP,
 * the Discussion feed and the questline map (`QuestlineLayout.stateOf`) all
 * derive from `acceptedAt` / `completedAt` / `shelvedAt`, and a column that
 * invented a fourth state would put two lifecycle models in one app. What
 * this buys is that the FRAME stops being hardcoded `New | subs |
 * Completed`: a project can mark a middle column as done-ish and have two
 * of them, or mark one as the not-started lane and have none synthesized.
 *
 * ⚠️ Kept in its own column rather than by turning `kanbanColumns` from
 * `string[]` into an array of objects. Changing the ELEMENT TYPE of a live
 * JSON column means every existing row stops decoding, and that does not
 * degrade to a missing field — it throws on every `projects` read. It is
 * the 2026-08-05 incident exactly (`apps/lore/CLAUDE.md`, "Renaming a
 * REQUIRED key inside a JSON column"). A separate nullable column is a
 * plain additive migration with nothing to backfill: `kanbanColumns` keeps
 * holding names and order, untouched, and a project with no config here
 * renders precisely the board it rendered before.
 *
 * An entry for a column that has since been renamed or deleted is inert
 * rather than wrong, and `renameKanbanColumn` carries its entry across.
 */
export const kanbanColumnSettingsSchema = z.object({
  /**
   * Which lifecycle state a card dropped in this column ends up in.
   * Absent means `accepted`, which is what every configured column meant
   * before this existed.
   */
  status: z.enum(["new", "accepted", "completed"]).optional(),
  /**
   * A soft cap. The header reads `3/5` and a drop past it warns; it never
   * refuses, because a hard block on your own board is a tool arguing with
   * you. Absent means no limit.
   */
  wipLimit: z.integer().min(1).max(999).optional(),
});

export type KanbanColumnSettings = Infer<typeof kanbanColumnSettingsSchema>;

/**
 * Column name to its settings. Names are unique per project, which is what
 * makes them usable as the key.
 */
export const kanbanColumnConfigSchema = z.record(
  z.text(),
  kanbanColumnSettingsSchema,
);

export type KanbanColumnConfigMap = Infer<typeof kanbanColumnConfigSchema>;
