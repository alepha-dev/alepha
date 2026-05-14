import { type Static, t } from "alepha";

/**
 * Normalized shape every parser produces. The controller writes from this
 * shape regardless of which format the CSV came from (Alepha Lore / Trello).
 *
 * Fields are pre-resolved string values; reference resolution (user email →
 * userId, chapter title → chapterId) happens in the controller using
 * per-campaign lookups.
 */
export const importRowSchema = t.object({
  /** 1-based data row number (header is row 0). Used for error/warning reporting. */
  rowIndex: t.integer({ minimum: 1 }),
  writeMode: t.union([t.const("upsert"), t.const("create")]),
  /** Empty string when absent. */
  shortId: t.string(),
  title: t.string(),
  description: t.string(),
  zone: t.string(),
  priority: t.enum(["optional", "low", "medium", "high"], { mode: "text" }),
  difficulty: t.integer({ minimum: 1, maximum: 5 }),
  /** Empty when null/unset. */
  kanbanColumn: t.string(),
  /** Chapter title (exact match). Empty when null/unset. */
  chapter: t.string(),
  /** Emails. Empty when null/unset. */
  createdBy: t.string(),
  acceptedBy: t.string(),
  completedBy: t.string(),
  /** ISO datetimes. Empty when null/unset. */
  createdAt: t.string(),
  acceptedAt: t.string(),
  completedAt: t.string(),
  /** Array of `{ title, completed }`. Empty array on omission. */
  objectives: t.array(t.object({ title: t.string(), completed: t.boolean() })),
});
export type ImportRow = Static<typeof importRowSchema>;

export const importIssueSchema = t.object({
  row: t.integer({ minimum: 1 }),
  message: t.string(),
});
export type ImportIssue = Static<typeof importIssueSchema>;

export const importResultSchema = t.object({
  format: t.enum(["alepha-lore", "trello"], { mode: "text" }),
  totalRows: t.integer({ minimum: 0 }),
  created: t.integer({ minimum: 0 }),
  updated: t.integer({ minimum: 0 }),
  skipped: t.integer({ minimum: 0 }),
  errors: t.array(importIssueSchema),
  warnings: t.array(importIssueSchema),
});
export type ImportResult = Static<typeof importResultSchema>;
