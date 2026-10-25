import { type Infer, z } from "alepha";

/**
 * The `note` dashboard metric's filters (#Q2659): the markdown the owner
 * writes. Stored on the card, like every metric's filters, so a note needs
 * no table of its own.
 */
export const noteFiltersSchema = z.object({
  markdown: z.text({ maxLength: 4000 }).default(""),
});

export type NoteFilters = Infer<typeof noteFiltersSchema>;
