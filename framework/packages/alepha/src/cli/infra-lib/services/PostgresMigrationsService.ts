import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

/**
 * One migration, in the shape drizzle's `pg-core` `migrate()` takes: what
 * drizzle's own `readMigrationFiles` builds from disk, built here from any
 * `FileSystemProvider`.
 */
export interface PostgresMigration {
  name: string;
  sql: string[];
  bps: boolean;
  folderMillis: number;
  hash: string;
}

/**
 * The connection the migrator runs on: one session, so the advisory lock,
 * the `search_path` and the migration are provably the same backend.
 */
export interface PostgresMigrationSession {
  query: (text: string, params?: unknown[]) => Promise<unknown[]>;
  migrate: (
    migrations: PostgresMigration[],
    config: { migrationsTable: string; migrationsSchema: string },
  ) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Applies an artifact's `migrations/postgres/` with no CLI and no disk
 * (#Q3508): the Postgres half of a prebuilt Cloudflare deploy, as
 * {@link D1MigrationsService} is the D1 half.
 *
 * Lore unpacks an artifact into a memory filesystem, and drizzle's folder
 * migrator reads `node:fs` only, so the migration list is built here from
 * `FileSystemProvider` with drizzle's own rules: one entry per folder holding
 * a `migration.sql`, sorted by name, the SQL split on
 * `--> statement-breakpoint`, `folderMillis` from the folder's first fourteen
 * digits, the sha256 of the whole file. drizzle picks pending migrations by
 * name, so a CLI apply, this migrator and a booting container see the same
 * pending set.
 *
 * The journal and the lock are every other Postgres migrate's:
 * `drizzle.migrations_<schema>`, and a session-level
 * `pg_advisory_lock(hashtext('alepha:migrate:<schema>'))` held on the one
 * connection that migrates (`PostgresProvider.migrateUnderLock`). A
 * transaction-scoped lock could not wrap drizzle's own transaction.
 *
 * postgres.js and drizzle's adapter are imported on use: on workerd they run
 * over `cloudflare:sockets`, and Lore's own Worker never evaluates them at
 * boot. `startTls` there takes no custom CA, so the database needs a
 * publicly trusted certificate on a DNS name.
 */
export class PostgresMigrationsService {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * The text drizzle-kit writes between two statements.
   */
  protected static readonly BREAKPOINT = "--> statement-breakpoint";

  /**
   * How long a deploy waits for another migrate of the same schema, in
   * milliseconds: `PostgresProvider`'s default.
   */
  protected readonly lockTimeout: number = 300_000;

  /**
   * Every migration under `dir`, in drizzle's order and shape. A missing
   * folder is no migration; a pre-v1 `meta/_journal.json` is refused, as
   * drizzle refuses it.
   */
  public async discover(dir: string): Promise<PostgresMigration[]> {
    const entries = (await this.fs.exists(dir))
      ? await this.fs.ls(dir).catch(() => [] as string[])
      : [];
    if (await this.fs.exists(this.fs.join(dir, "meta", "_journal.json"))) {
      throw new AlephaError(
        `'${dir}' still uses drizzle-kit's pre-v1 layout (meta/_journal.json). Run 'alepha db baseline create' and redeploy.`,
      );
    }

    const migrations: PostgresMigration[] = [];
    for (const raw of entries.map((it) => it.split("/").pop() as string)) {
      const path = this.fs.join(dir, raw, "migration.sql");
      if (!(await this.fs.exists(path))) {
        continue;
      }
      const query = await this.fs.readTextFile(path);
      migrations.push({
        name: raw,
        sql: query.split(PostgresMigrationsService.BREAKPOINT),
        bps: true,
        folderMillis: this.folderMillis(raw),
        hash: await this.sha256(query),
      });
    }
    // drizzle sorts with `localeCompare`, and so does this.
    return migrations.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Apply the pending migrations of `root/migrationsDir` to the database
   * `url` names, and answer how many it applied: what a deployer records so
   * a rollback can see a schema change (#Q3479).
   */
  public async apply(options: {
    url: string;
    schema?: string;
    root?: string;
    migrationsDir?: string;
  }): Promise<number> {
    const schema = options.schema || "public";
    const dir = this.fs.join(
      options.root ?? ".",
      options.migrationsDir ?? "migrations/postgres",
    );
    const migrations = await this.discover(dir);
    if (migrations.length === 0) {
      this.log.info("No Postgres migrations to apply");
      return 0;
    }

    const target = this.describe(options.url);
    const session = await this.open(options.url, target);
    const key = `alepha:migrate:${schema}`;
    const table = `migrations_${schema}`;
    try {
      await session.query(`SET lock_timeout = ${this.lockTimeout}`);
      try {
        await session.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
      } catch (error) {
        throw new AlephaError(
          `Could not take the migration lock '${key}' on ${target} within ${this.lockTimeout} ms: another deploy or instance is still migrating this schema.`,
          { cause: this.scrub(error, options.url) },
        );
      }
      await session.query("SET lock_timeout = 0");

      try {
        if (schema !== "public") {
          await session.query(
            `CREATE SCHEMA IF NOT EXISTS ${this.identifier(schema)}`,
          );
          await session.query(
            `SET search_path TO ${this.identifier(schema)}, public`,
          );
        }
        const applied = new Set(await this.appliedNames(session, table));
        const pending = migrations.filter((it) => !applied.has(it.name));
        if (pending.length === 0) {
          this.log.info(`No pending Postgres migrations on ${target}`);
          return 0;
        }
        this.log.info(
          `Applying ${pending.length} Postgres migration(s) to ${target} ...`,
        );
        try {
          await session.migrate(migrations, {
            migrationsTable: table,
            migrationsSchema: "drizzle",
          });
        } catch (error) {
          throw new AlephaError(
            `Postgres migration failed on ${target}: ${this.message(error, options.url)}`,
            { cause: this.scrub(error, options.url) },
          );
        }
        this.log.info(`Applied ${pending.length} Postgres migration(s)`);
        return pending.length;
      } finally {
        await session
          .query("SELECT pg_advisory_unlock(hashtext($1))", [key])
          .catch(() => undefined);
      }
    } finally {
      await session.close();
    }
  }

  /**
   * The names the journal holds; none when it does not exist yet.
   */
  protected async appliedNames(
    session: PostgresMigrationSession,
    table: string,
  ): Promise<string[]> {
    const [exists] = (await session.query(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [`drizzle.${table}`],
    )) as Array<{ present: boolean }>;
    if (!exists?.present) {
      return [];
    }
    const rows = (await session.query(
      `SELECT name FROM drizzle.${this.identifier(table)}`,
    )) as Array<{ name: string | null }>;
    return rows
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string");
  }

  /**
   * One connection (`max: 1`), opened with postgres.js imported on use.
   * The connect itself is tried here, so a refusal is reported before the
   * lock and with the reason, never with the URL.
   */
  protected async open(
    url: string,
    target: string,
  ): Promise<PostgresMigrationSession> {
    const [pg, drizzleModule, pgCore] = await Promise.all([
      import("postgres"),
      import("drizzle-orm/postgres-js"),
      import("drizzle-orm/pg-core"),
    ]);
    const postgres = (pg.default ?? pg) as typeof import("postgres").default;
    const parsed = new URL(url);
    const sslmode = parsed.searchParams.get("sslmode");
    const client = postgres({
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
      max: 1,
      ssl:
        sslmode === "disable"
          ? false
          : (sslmode as "require" | "prefer" | "verify-full" | null) ||
            undefined,
      onnotice: () => {},
    });
    try {
      await client`SELECT 1`;
    } catch (error) {
      await client.end({ timeout: 1 }).catch(() => undefined);
      throw new AlephaError(
        `Could not connect to ${target}: ${this.message(error, url)}`,
        { cause: this.scrub(error, url) },
      );
    }
    const db = drizzleModule.drizzle({ client });
    return {
      query: async (text, params) =>
        (await client.unsafe(text, (params ?? []) as any[])) as unknown[],
      migrate: async (migrations, config) => {
        // `migrationsFolder` is the folder migrator's field: this list is
        // already built, so the config carries the table alone.
        await pgCore.migrate(migrations as any, db as any, config as any);
      },
      close: async () => {
        await client.end({ timeout: 5 });
      },
    };
  }

  /**
   * `host:port/database` as a log may print it: never the user or password.
   */
  protected describe(url: string): string {
    const parsed = new URL(url);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    return `${parsed.hostname}:${parsed.port || 5432}/${database}`;
  }

  /**
   * The reason a driver error gives, with any credential in it removed, and
   * the certificate case said plainly.
   */
  protected message(error: unknown, url: string): string {
    const raw = error instanceof Error ? error.message : String(error);
    const text = this.redact(raw, url);
    if (/certificate|self[- ]signed|unable to verify|CERT_/i.test(text)) {
      return `${text}. The database needs a publicly trusted certificate on a DNS name: a Worker's TLS takes no custom CA, so a self-signed or private-CA certificate cannot work.`;
    }
    return text;
  }

  /**
   * An error safe to keep as a cause: the deploy log every member reads
   * carries causes too.
   */
  protected scrub(error: unknown, url: string): Error {
    const scrubbed = new AlephaError(this.message(error, url));
    if (error instanceof Error) {
      scrubbed.name = error.name;
    }
    return scrubbed;
  }

  protected redact(text: string, url: string): string {
    let out = text.split(url).join("<DATABASE_URL>");
    try {
      const password = decodeURIComponent(new URL(url).password);
      if (password) {
        out = out.split(password).join("****");
      }
    } catch {
      // not a URL: nothing more to hide
    }
    return out;
  }

  protected identifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  /**
   * drizzle's `formatToMillis`: the folder's leading `YYYYMMDDHHMMSS`, as UTC.
   */
  protected folderMillis(name: string): number {
    const d = name.slice(0, 14);
    return Date.UTC(
      Number(d.slice(0, 4)),
      Number(d.slice(4, 6)) - 1,
      Number(d.slice(6, 8)),
      Number(d.slice(8, 10)),
      Number(d.slice(10, 12)),
      Number(d.slice(12, 14)),
    );
  }

  /**
   * Hex sha256, through Web Crypto: present on Node, Bun and workerd alike.
   */
  protected async sha256(text: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
}
