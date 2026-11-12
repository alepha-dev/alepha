import { DbUrlError } from "../errors/DbUrlError.ts";

/**
 * What a `DATABASE_URL` names, once parsed.
 *
 * - `sqlite`: a file, or memory when `path` is `:memory:`.
 * - `d1`: a Cloudflare D1 binding, `d1://<binding>` or `d1://<name>:<id>`.
 * - `postgres`: a Postgres server; `url` is the URL as given.
 * - `hyperdrive`: a Cloudflare Hyperdrive binding, `hyperdrive://<binding>`.
 */
export type DatabaseUrl =
  | { kind: "sqlite"; url: string; path: string }
  | { kind: "d1"; url: string; name: string; id?: string }
  | { kind: "postgres"; url: string }
  | { kind: "hyperdrive"; url: string; binding: string }
  | { kind: "pglite"; url: string; path: string };

export type DatabaseUrlKind = DatabaseUrl["kind"];

/**
 * The one reader of `DATABASE_URL`: every driver choice, at runtime and on
 * deploy, goes through it.
 *
 * Known schemes only. A bare path (POSIX, or a Windows drive letter such as
 * `C:\data\app.db`), `sqlite:`, `sqlite://`, `file:` and `:memory:` are
 * SQLite; `d1://` is D1; `postgres:` and `postgresql:` are Postgres;
 * `hyperdrive://` is Hyperdrive. Anything else throws `DbUrlError`, which
 * names the scheme and never the rest of the URL, since it may carry a
 * password.
 *
 * @example
 * ```ts
 * const parsed = new DatabaseUrlParser().parse(process.env.DATABASE_URL);
 * if (parsed?.kind === "postgres") {
 *   // ...
 * }
 * ```
 */
export class DatabaseUrlParser {
  /**
   * The schemes accepted, as the error lists them.
   */
  public readonly accepted = [
    "a file path",
    ":memory:",
    "sqlite:",
    "file:",
    "d1:",
    "postgres:",
    "postgresql:",
    "hyperdrive:",
    "pglite:",
  ];

  /**
   * Parse a URL. An empty or missing one is `undefined`: the caller picks
   * its default (SQLite).
   */
  public parse(url: string | undefined | null): DatabaseUrl | undefined {
    if (url === undefined || url === null) {
      return undefined;
    }
    const value = String(url).trim();
    if (value === "") {
      return undefined;
    }

    if (value === ":memory:") {
      return { kind: "sqlite", url: value, path: ":memory:" };
    }

    const scheme = this.scheme(value);
    if (scheme === undefined) {
      return { kind: "sqlite", url: value, path: value };
    }

    const rest = value.slice(scheme.length + 1);
    switch (scheme.toLowerCase()) {
      case "sqlite":
      case "file":
        return { kind: "sqlite", url: value, path: this.stripSlashes(rest) };
      case "postgres":
      case "postgresql":
        return { kind: "postgres", url: value };
      case "d1": {
        const [name, id] = this.stripSlashes(rest).split(":");
        return id
          ? { kind: "d1", url: value, name, id }
          : { kind: "d1", url: value, name };
      }
      case "hyperdrive":
        return {
          kind: "hyperdrive",
          url: value,
          binding: this.stripSlashes(rest),
        };
      case "pglite":
        return { kind: "pglite", url: value, path: this.stripSlashes(rest) };
      default:
        throw new DbUrlError({
          scheme,
          accepted: this.accepted.join(", "),
        });
    }
  }

  /**
   * The kind alone; `undefined` for a missing URL.
   */
  public kind(url: string | undefined | null): DatabaseUrlKind | undefined {
    return this.parse(url)?.kind;
  }

  /**
   * True when the URL names a Postgres server (`postgres:` or
   * `postgresql:`), the case a Cloudflare deploy turns into Hyperdrive.
   */
  public isPostgres(url: string | undefined | null): boolean {
    return this.kind(url) === "postgres";
  }

  /**
   * The scheme of a URL, or `undefined` for a path. A single letter followed
   * by `:\` or `:/` is a Windows drive, not a scheme.
   */
  protected scheme(value: string): string | undefined {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
    if (!match) {
      return undefined;
    }
    const scheme = match[1];
    if (scheme.length === 1 && /^[a-zA-Z]:[\\/]/.test(value)) {
      return undefined;
    }
    return scheme;
  }

  /**
   * `//path` becomes `path`, and `///abs` becomes `/abs`: the authority
   * slashes go, an absolute path keeps its own.
   */
  protected stripSlashes(rest: string): string {
    return rest.startsWith("//") ? rest.slice(2) : rest;
  }
}
