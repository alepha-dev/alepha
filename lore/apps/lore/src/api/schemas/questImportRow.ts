import { type Infer, z } from "alepha";

/**
 * Normalized shape every parser produces. The controller writes from this
 * shape regardless of which format the CSV came from (Alepha Lore / Trello).
 *
 * Fields are pre-resolved string values; reference resolution (user email →
 * userId, milestone title → milestoneId) happens in the controller using
 * per-project lookups.
 */
export const importRowSchema = z.object({
  /**
   * 1-based data row number (header is row 0). Used for error/warning reporting.
   */
  rowIndex: z.integer().min(1),
  writeMode: z.union([z.const("upsert"), z.const("create")]),
  /**
   * Empty string when absent.
   */
  shortId: z.string(),
  title: z.string(),
  description: z.string(),
  area: z.string(),
  priority: z
    .enum(["optional", "low", "medium", "high"])
    .meta({ mode: "text" }),
  /**
   * T-shirt size ordinal, 1 (XS) to 5 (XL).
   *
   * Required here so every parser has to decide what it means for its own
   * format, but no parser ever fails a row over it: an absent, empty or
   * out-of-range cell lands on 3 (M), the same neutral middle the column
   * defaults to. A CSV exported before the field existed must still import.
   */
  size: z.integer().min(1).max(5),
  /**
   * Empty when null/unset.
   */
  kanbanColumn: z.string(),
  /**
   * Milestone title (exact match). Empty when null/unset.
   */
  milestone: z.string(),
  /**
   * Emails. Empty when null/unset.
   */
  createdBy: z.string(),
  acceptedBy: z.string(),
  completedBy: z.string(),
  /**
   * ISO datetimes. Empty when null/unset.
   */
  createdAt: z.string(),
  acceptedAt: z.string(),
  completedAt: z.string(),
  /**
   * Array of `{ title, completed }`. Empty array on omission.
   */
  objectives: z.array(z.object({ title: z.string(), completed: z.boolean() })),
});
export type ImportRow = Infer<typeof importRowSchema>;

export const importIssueSchema = z.object({
  row: z.integer().min(1),
  message: z.string(),
});
export type ImportIssue = Infer<typeof importIssueSchema>;

export const importResultSchema = z.object({
  format: z.enum(["alepha-lore", "trello"]).meta({ mode: "text" }),
  totalRows: z.integer().min(0),
  created: z.integer().min(0),
  updated: z.integer().min(0),
  skipped: z.integer().min(0),
  errors: z.array(importIssueSchema),
  warnings: z.array(importIssueSchema),
});
export type ImportResult = Infer<typeof importResultSchema>;
