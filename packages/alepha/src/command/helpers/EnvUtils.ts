import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

export class EnvUtils {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Load environment variables from .env files into process.env.
   *
   * Variables that already exist in process.env are NOT overwritten,
   * matching the standard dotenv convention where the shell environment
   * takes precedence over .env file values.
   *
   * For EVERY file given, the `.local` sibling is also loaded and takes
   * precedence — so the default `[".env"]` reads `.env` then `.env.local`,
   * and `[".env", ".env.production"]` reads four files in that order. This
   * was always the behaviour; the doc used to describe only the default
   * case, which made the multi-file form surprising.
   */
  public async loadEnv(
    root: string,
    files: string[] = [".env"],
  ): Promise<void> {
    const vars = await this.parseEnv(root, files);
    for (const [key, value] of Object.entries(vars)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  /**
   * Parse environment variables from .env files without mutating process.env.
   *
   * Returns a merged record from all files (later files override earlier ones).
   * For each file, also tries the `.local` variant (e.g. `.env.production.local`).
   */
  public async parseEnv(
    root: string,
    files: string[] = [".env"],
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const it of files) {
      for (const file of [it, `${it}.local`]) {
        const envPath = this.fs.join(root, file);
        try {
          const buffer = await this.fs.readFile(envPath);
          Object.assign(result, this.parseEnvContent(buffer.toString("utf8")));
          this.log.debug(`Parsed environment variables from ${envPath}`);
        } catch (error) {
          // Only "not there" is routine. Swallowing everything hid a real
          // EACCES / EISDIR behind a debug line, so a .env the process could
          // not read looked identical to one that did not exist.
          const code = (error as { code?: string })?.code;
          if (code && code !== "ENOENT") {
            this.log.warn(`Could not read ${envPath}: ${code}`, error);
            continue;
          }
          this.log.debug(`No ${file} file found at ${envPath}, skipping.`);
        }
      }
    }

    return result;
  }

  /**
   * Parse the body of a `.env` file.
   *
   * Follows dotenv's own grammar, because a `.env` that works with every
   * other tool has to parse the same way here. Concretely, and each of these
   * used to be wrong:
   *
   * - `export KEY=value` sets `KEY`, not a key literally named `export KEY`.
   * - `KEY=value # note` sets `value`. An unquoted value ends at the first
   *   `#`, so it can never contain one - that is dotenv's rule, not a
   *   simplification.
   * - A bare `KEY` line with no `=` is ignored rather than setting an empty
   *   string, which is the difference between "unset" and "set to nothing"
   *   and changes what `$env` schemas do with it.
   * - A quoted value may span lines.
   *
   * **One deliberate divergence.** A double-quoted value is JSON-decoded
   * first, so escapes round-trip with a `JSON.stringify`-based writer (the
   * `.env.<env>.local` overrides do exactly that). When the body is not valid
   * JSON the quotes are simply stripped, with no escape expansion - dotenv
   * would turn the `\n` of a Windows path like `"C:\new\dir"` into a
   * newline, and that path is a real thing people write.
   */
  public parseEnvContent(content: string): Record<string, string> {
    // dotenv's own line grammar. Kept verbatim so the two cannot drift:
    // optional `export`, key, `=` or `: `, then a quoted value (which may
    // span lines) or an unquoted one that stops at the first `#`.
    const line =
      /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

    const result: Record<string, string> = {};
    const normalized = content.replace(/\r\n?/g, "\n");

    let match: RegExpExecArray | null = line.exec(normalized);
    while (match !== null) {
      const value = (match[2] ?? "").trim();
      result[match[1]] = this.unquoteEnvValue(value);
      match = line.exec(normalized);
    }

    return result;
  }

  /**
   * Strip the surrounding quotes of a `.env` value, if it has a matching
   * pair. An unbalanced quote is part of the value - `FOO="` is the one
   * character, not an unterminated string.
   */
  protected unquoteEnvValue(value: string): string {
    const quote = value[0];
    const last = value.length - 1;
    if (value.length < 2 || value[last] !== quote) {
      return value;
    }

    if (quote === '"') {
      try {
        return JSON.parse(value);
      } catch {
        return value.slice(1, -1);
      }
    }

    if (quote === "'" || quote === "`") {
      return value.slice(1, -1);
    }

    return value;
  }
}
