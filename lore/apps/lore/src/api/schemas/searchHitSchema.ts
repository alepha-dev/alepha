import { z } from "alepha";

/**
 * One row of the ⌘K palette: what it is, how to address it, and a line of
 * context. Deliberately four fields wide — see `SearchController.search`
 * for why the palette does not reuse the full quest / folio resources.
 */
export const searchHitSchema = z.object({
  kind: z.enum(["quest", "folio", "directory"]),
  id: z.string(),
  shortId: z.integer(),
  title: z.string(),
  /**
   * One line of context under the title in the palette — a quest's
   * description, a folio's summary. Absent for a directory, which has no
   * body, and for anything whose source field is empty.
   *
   * Truncated HERE rather than in the browser: a folio summary or quest
   * description can run to paragraphs, and a twelve-row palette has no use
   * for the rest of it. Sending it whole would put kilobytes on the wire per
   * keystroke to render ~140 characters.
   *
   * ⚠️ A protected folio's body never reaches this field — `summary` is the
   * only source used, and it is deliberately the one part of a protected
   * folio that stays plaintext (its `searchText` is blank by design). Do not
   * "improve" this by falling back to `content` for folios with no summary.
   */
  description: z.string().optional(),
  /**
   * Set only for a protected folio, so a caller can mark it without
   * having to know that "protected" is a flag rather than a kind.
   */
  protected: z.boolean().optional(),
});
