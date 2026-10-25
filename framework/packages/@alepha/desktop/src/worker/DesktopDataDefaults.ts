import { isAbsolute, join } from "node:path";

import type { Alepha } from "alepha";
import { AlephaError } from "alepha";

/**
 * Where a desktop app's framework-managed data goes, decided once the app is
 * created and before it starts.
 *
 * - The default SQLite connection (Bun's) opens `<data>/app.db`, when the app
 *   names no database at all. Without it, Bun's provider falls back to the
 *   relative `node_modules/.alepha/bun-sqlite.db`, which inside a bundle
 *   launched from Finder resolves against `Contents/Resources` (read-only)
 *   or `/`.
 * - An explicit `DATABASE_URL`, or a path the app gave the SQLite provider,
 *   wins. A Postgres or D1 URL is left alone: nothing turns such an app into a
 *   SQLite one.
 * - A relative writable path (`DATABASE_URL=sqlite://app.db`,
 *   `APP_SECRET_FILE=secret`) is refused with the reason, rather than written
 *   into the read-only bundle.
 *
 * `APP_SECRET_FILE` itself defaults to `<data>/secret` through the
 * environment, before the app is created; `SecretProvider` generates it on
 * first launch, owner-only, and an explicit `APP_SECRET` still wins.
 *
 * ⚠️ The SQLite option is set through the store by its key, not through the
 * `bunSqliteOptions` atom: the app bundle carries its own copy of `alepha`,
 * and the key is what both copies share.
 */
export class DesktopDataDefaults {
  /**
   * The store key of Bun's SQLite provider options.
   */
  public readonly sqliteOptionsKey = "alepha.postgres.bun-sqlite.options";

  public apply(alepha: Alepha, paths: { data: string }): void {
    const env = alepha.env as Record<string, unknown>;

    const secretFile = env.APP_SECRET_FILE;
    if (
      typeof secretFile === "string" &&
      secretFile &&
      !isAbsolute(secretFile)
    ) {
      throw new AlephaError(
        `APP_SECRET_FILE '${secretFile}' is relative. A desktop app's bundle is read-only: give it an absolute path, or leave it unset to use ${join(paths.data, "secret")}.`,
      );
    }

    const url = env.DATABASE_URL;
    if (typeof url === "string" && url) {
      this.assertAbsolute("DATABASE_URL", this.sqliteFile(url), paths);
      return;
    }

    const store = alepha.store as unknown as {
      get(key: string): { path?: string } | undefined;
      set(key: string, value: unknown): unknown;
    };
    const options = store.get(this.sqliteOptionsKey);
    if (options?.path) {
      this.assertAbsolute(
        "The SQLite path",
        this.sqliteFile(options.path),
        paths,
      );
      return;
    }
    store.set(this.sqliteOptionsKey, {
      ...options,
      path: join(paths.data, "app.db"),
    });
  }

  /**
   * The file a SQLite URL or path points at, or undefined when it is not a
   * SQLite file (another driver, or memory).
   */
  public sqliteFile(url: string): string | undefined {
    if (url === ":memory:") {
      return undefined;
    }
    if (url.startsWith("sqlite://")) {
      return url.slice("sqlite://".length);
    }
    if (url.startsWith("sqlite:")) {
      return url.slice("sqlite:".length);
    }
    if (url.includes("://") || /^[a-z0-9]+:/i.test(url)) {
      return undefined;
    }
    return url;
  }

  protected assertAbsolute(
    what: string,
    file: string | undefined,
    paths: { data: string },
  ): void {
    if (file && file !== ":memory:" && !isAbsolute(file)) {
      throw new AlephaError(
        `${what} points at '${file}', a relative path. A desktop app's bundle is read-only: give it an absolute path, or leave it unset to use ${join(paths.data, "app.db")}.`,
      );
    }
  }
}
