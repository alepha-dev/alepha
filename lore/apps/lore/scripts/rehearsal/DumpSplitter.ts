import { AlephaError } from "alepha";

/**
 * Rewrites the statements of a `wrangler d1 export` dump that D1 refuses to
 * import because they are too long (`statement too long: SQLITE_TOOBIG`, D1's
 * 100 KB limit per statement, 2026-10-04).
 *
 * Production holds rows that were written with bound parameters, which have no
 * such limit, so the dump of one row can be a single INSERT longer than D1
 * will run. Such an INSERT is replayed as the same row with each long text
 * value left empty, followed by `UPDATE ... SET col = col || <chunk>` on that
 * row until the value is whole again. Row counts and values come out
 * identical; only the number of statements changes.
 *
 * It relies on the export's shape, checked against wrangler 4.144: one
 * statement per line (newlines inside values are written as
 * `replace('a\nb','\n',char(10))`), and every INSERT naming its columns.
 */
export class DumpSplitter {
  /**
   * The longest statement left as it is. Under D1's 100 KB with room to spare.
   */
  public static readonly MAX_BYTES = 90_000;

  /**
   * A value longer than this is moved out of its INSERT.
   */
  public static readonly LONG_VALUE_BYTES = 10_000;

  /**
   * Characters per appended chunk: at most four bytes each in UTF-8, so a
   * chunk stays far under `MAX_BYTES` with its `UPDATE` around it.
   */
  public static readonly CHUNK_CHARS = 15_000;

  /**
   * The dump with every over-long INSERT rewritten, and how many were.
   */
  public split(dump: string): { sql: string; rewritten: number } {
    let rewritten = 0;
    const lines = dump.split("\n").flatMap((line) => {
      if (Buffer.byteLength(line) <= DumpSplitter.MAX_BYTES) {
        return [line];
      }
      rewritten += 1;
      return this.rewrite(line);
    });
    return { sql: lines.join("\n"), rewritten };
  }

  /**
   * One over-long INSERT as an INSERT with its long text values emptied,
   * then the appends that restore them on the row just inserted.
   */
  protected rewrite(line: string): string[] {
    const match =
      /^INSERT INTO ("(?:[^"]|"")+") \(([^)]*)\) VALUES\((.*)\);$/.exec(line);
    if (!match) {
      throw new AlephaError(
        `A dump statement of ${Buffer.byteLength(line)} bytes is not an INSERT this splitter can read: ${line.slice(0, 80)}`,
      );
    }
    const [, table, columnList, valueList] = match;
    const columns = this.splitTopLevel(columnList);
    const values = this.splitTopLevel(valueList);
    if (columns.length !== values.length) {
      throw new AlephaError(
        `An INSERT into ${table} names ${columns.length} columns for ${values.length} values.`,
      );
    }

    const appends: string[] = [];
    const inserted = values.map((value, index) => {
      if (Buffer.byteLength(value) <= DumpSplitter.LONG_VALUE_BYTES) {
        return value;
      }
      const literal = this.longestLiteral(value);
      if (!literal) {
        throw new AlephaError(
          `A value of ${Buffer.byteLength(value)} bytes in ${table}.${columns[index]} holds no text literal to split.`,
        );
      }
      const column = columns[index];
      const before = value.slice(0, literal.start);
      const after = value.slice(literal.end);
      for (const chunk of this.chunks(literal.text)) {
        appends.push(
          `UPDATE ${table} SET ${column} = ${column} || ${before}${this.quote(chunk)}${after} WHERE rowid = last_insert_rowid();`,
        );
      }
      return `${before}''${after}`;
    });

    const statements = [
      `INSERT INTO ${table} (${columnList}) VALUES(${inserted.join(",")});`,
      ...appends,
    ];
    for (const statement of statements) {
      if (Buffer.byteLength(statement) > DumpSplitter.MAX_BYTES) {
        throw new AlephaError(
          `A row of ${table} is still ${Buffer.byteLength(statement)} bytes after splitting its long text values.`,
        );
      }
    }
    return statements;
  }

  /**
   * Split on the commas that are outside quotes and parentheses.
   */
  protected splitTopLevel(list: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quote: string | undefined;
    let start = 0;
    for (let i = 0; i < list.length; i++) {
      const char = list[i];
      if (quote) {
        if (char === quote) {
          // A doubled quote is an escaped one, and stays inside the literal.
          if (list[i + 1] === quote) i++;
          else quote = undefined;
        }
      } else if (char === "'" || char === '"') {
        quote = char;
      } else if (char === "(") {
        depth++;
      } else if (char === ")") {
        depth--;
      } else if (char === "," && depth === 0) {
        parts.push(list.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(list.slice(start));
    return parts;
  }

  /**
   * The longest `'...'` literal in a value expression, decoded, with its
   * position (quotes included).
   */
  protected longestLiteral(
    value: string,
  ): { start: number; end: number; text: string } | undefined {
    let best: { start: number; end: number; text: string } | undefined;
    for (let i = 0; i < value.length; i++) {
      if (value[i] !== "'") continue;
      // A blob is X'..', not text: skip it whole.
      const blob = i > 0 && /[xX]/.test(value[i - 1]);
      let j = i + 1;
      for (; j < value.length; j++) {
        if (value[j] === "'") {
          if (value[j + 1] === "'") j++;
          else break;
        }
      }
      if (!blob && (!best || j + 1 - i > best.end - best.start)) {
        best = {
          start: i,
          end: j + 1,
          text: value.slice(i + 1, j).replace(/''/g, "'"),
        };
      }
      i = j;
    }
    return best;
  }

  /**
   * Cut a decoded literal into chunks, never right after a backslash: the
   * export writes a newline as the two characters `\n` inside a
   * `replace(..., '\n', char(10))`, and a chunk boundary between them would
   * leave a literal backslash behind.
   */
  protected chunks(text: string): string[] {
    const out: string[] = [];
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + DumpSplitter.CHUNK_CHARS, text.length);
      // Nor inside a surrogate pair, which would cut an emoji in half.
      while (
        end < text.length &&
        end > start + 1 &&
        (text[end - 1] === "\\" || /[\uD800-\uDBFF]/.test(text[end - 1]))
      ) {
        end--;
      }
      out.push(text.slice(start, end));
      start = end;
    }
    return out;
  }

  protected quote(text: string): string {
    return `'${text.replace(/'/g, "''")}'`;
  }
}
