import { z } from "alepha";

/**
 * One line of a hunk (#Q4135). `anchor` is `${path}:${side}:${line}`, the
 * stable id a pull request's line comment hangs off (#E169): `old` for a
 * deleted line, `new` for an added or an unchanged one.
 */
export const codeDiffLineSchema = z.object({
  kind: z.enum(["context", "add", "del"]),
  oldLine: z.integer().optional(),
  newLine: z.integer().optional(),
  text: z.string(),
  anchor: z.text({ maxLength: 4200 }),
  /**
   * The last line of its side, which has no newline at its end.
   */
  noNewline: z.boolean().optional(),
});
