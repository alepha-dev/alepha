/**
 * A criterion's evidence, read for a human first (#Q4210): what was expected,
 * what was seen, anything else worth knowing, then the developer's details.
 */
export interface RunNoteShape {
  /**
   * Text before the first labelled line, if any.
   */
  intro?: string;
  rows: Array<{ label: RunNoteLabel; text: string }>;
  /**
   * Everything from the `Details:` line on: page, state, repro steps, ids.
   */
  details?: string;
}

export type RunNoteLabel = "expected" | "seen" | "also";

/**
 * Reads a criterion's note in the shape the agent guidance asks for:
 *
 * ```
 * Expected: choosing a region narrows every chart.
 * Seen: only the orders chart narrows.
 * Also: the picker offers no store.
 * Details: page /overview, region north. Repro: ...
 * ```
 *
 * A line may continue the label above it. A note with none of these labels
 * is not in the shape, and is shown as the Markdown it is.
 *
 * Static: a pure reading of a string, with nothing to substitute, so a
 * component calls it without a container registration.
 */
export class RunNote {
  protected static readonly row =
    /^\s*(?:[-*]\s+)?\**(expected|seen|also)\**\s*:\**\s*(.*)$/i;

  protected static readonly details =
    /^\s*(?:[-*]\s+)?\**details\**(?:\s*\([^)]*\))?\s*:\**\s*(.*)$/i;

  /**
   * The note's shape, or `undefined` for a note that is plain text.
   */
  public static parse(note: string): RunNoteShape | undefined {
    const intro: string[] = [];
    const rows: RunNoteShape["rows"] = [];
    let details: string[] | undefined;
    for (const line of note.split(/\r?\n/)) {
      if (details) {
        details.push(line);
        continue;
      }
      const opened = this.details.exec(line);
      if (opened) {
        details = [opened[1]];
        continue;
      }
      const labelled = this.row.exec(line);
      if (labelled) {
        rows.push({
          label: labelled[1].toLowerCase() as RunNoteLabel,
          text: labelled[2],
        });
      } else if (rows.length) {
        rows[rows.length - 1].text += `\n${line}`;
      } else {
        intro.push(line);
      }
    }
    if (!rows.length && !details) {
      return undefined;
    }
    const text = (lines: string[] | undefined) =>
      lines?.join("\n").trim() || undefined;
    return {
      intro: text(intro),
      rows: rows
        .map((row) => ({ ...row, text: row.text.trim() }))
        .filter((row) => row.text),
      details: text(details),
    };
  }
}
