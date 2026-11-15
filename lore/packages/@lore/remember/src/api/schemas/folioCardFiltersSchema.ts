import { type Infer, z } from "alepha";

/**
 * The Folio card's filters (#E144, #Q3520): which folio, by its per-project
 * number, what to show of it, and how many rows.
 *
 * `folio` defaults to 0, "none picked yet", so the catalogue can start from
 * the defaults; a card on 0 resolves as having no folio. `show: auto` picks
 * by what the folio is: a note for a text folio, the next dated rows for a
 * table read as a calendar, its first rows for any other table.
 */
export const folioCardFiltersSchema = z.object({
  folio: z.integer().min(0).default(0),
  show: z.enum(["auto", "note", "rows", "upcoming"]).default("auto"),
  limit: z.integer().min(3).max(20).optional(),
});

export type FolioCardFilters = Infer<typeof folioCardFiltersSchema>;
