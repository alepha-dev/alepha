/**
 * One `KEY=value` line of a `.env`, as the import sends it.
 */
export interface DotenvEntry {
  key: string;
  value: string;
  /**
   * 1-based, so a preview can point at the line a person sees.
   */
  line: number;
}

/**
 * A line the parser could not read, with the reason in plain words.
 */
export interface DotenvError {
  line: number;
  text: string;
  reason: "syntax" | "unterminated";
}

export interface DotenvParseResult {
  /**
   * Every key once, with the LAST value it was given, as dotenv itself reads a
   * repeated key.
   */
  entries: DotenvEntry[];
  errors: DotenvError[];
  /**
   * Keys given more than once. Kept so the preview can say which value won.
   */
  duplicates: string[];
}

/**
 * Reads `.env` text for the Environment tab's import (#Q2468).
 *
 * The subset every real `.env` uses: `KEY=value`, `export KEY=value`, `#`
 * comments and blank lines, single-quoted values taken literally,
 * double-quoted values with `\n` and `\"` escapes (and spanning lines until
 * the closing quote), and a trailing ` # comment` after an unquoted value.
 * Names are not validated here: the server's rules decide, and the preview
 * shows its refusals separately.
 *
 * A class with a static entry point rather than a loose function, so it stays
 * one substitutable unit and its spec reads it as one.
 */
export class DotenvParser {
  public static parse(text: string): DotenvParseResult {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const found = new Map<string, DotenvEntry>();
    const duplicates = new Set<string>();
    const errors: DotenvError[] = [];

    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index] ?? "";
      const line = index + 1;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const match =
        /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(trimmed);
      if (!match) {
        errors.push({ line, text: raw, reason: "syntax" });
        continue;
      }
      const key = match[1] ?? "";
      let rest = match[2] ?? "";
      let value: string;

      if (rest.startsWith('"')) {
        // A double-quoted value may span lines until its closing quote.
        let body = rest.slice(1);
        let end = DotenvParser.closingQuote(body);
        while (end === -1 && index + 1 < lines.length) {
          index++;
          body += `\n${lines[index] ?? ""}`;
          end = DotenvParser.closingQuote(body);
        }
        if (end === -1) {
          errors.push({ line, text: raw, reason: "unterminated" });
          continue;
        }
        value = body
          .slice(0, end)
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      } else if (rest.startsWith("'")) {
        const end = rest.indexOf("'", 1);
        if (end === -1) {
          errors.push({ line, text: raw, reason: "unterminated" });
          continue;
        }
        value = rest.slice(1, end);
      } else {
        // An unquoted value ends at a ` #` comment, as dotenv reads it.
        const comment = rest.search(/\s#/);
        if (comment !== -1) {
          rest = rest.slice(0, comment);
        }
        value = rest.trim();
      }

      if (found.has(key)) {
        duplicates.add(key);
        found.delete(key);
      }
      found.set(key, { key, value, line });
    }

    return {
      entries: [...found.values()],
      errors,
      duplicates: [...duplicates],
    };
  }

  /**
   * The index of the first unescaped `"`, or -1.
   */
  protected static closingQuote(body: string): number {
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "\\") {
        i++;
        continue;
      }
      if (body[i] === '"') {
        return i;
      }
    }
    return -1;
  }
}
