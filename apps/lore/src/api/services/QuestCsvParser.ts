/**
 * Decode CSV text into a 2D array of strings using RFC 4180 rules:
 * - Comma-separated fields, newline-separated rows.
 * - Fields may be wrapped in `"..."`. Inside quoted fields, `""` is a literal `"`.
 * - Quoted fields may contain commas and newlines.
 * - A trailing newline at end-of-file is ignored.
 *
 * Pure parsing; no schema interpretation. Header sniffing and per-row
 * normalization are the responsibility of the format-specific parsers.
 */
export class QuestCsvParser {
  public parse(text: string): string[][] {
    const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < stripped.length; i++) {
      const c = stripped[i];
      if (inQuotes) {
        if (c === '"') {
          if (stripped[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
        continue;
      }
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // swallow; the \n that follows finishes the row
      } else {
        field += c;
      }
    }
    // Tail row (no trailing newline).
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }
}
