import { AlephaError } from "alepha";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { PostgresProvider } from "./PostgresProvider.ts";

export class NodePostgresProvider extends PostgresProvider {
  static readonly SSL_MODES = [
    "require",
    "allow",
    "prefer",
    "verify-full",
  ] as const;

  protected client?: postgres.Sql;
  protected pg?: PostgresJsDatabase;

  /**
   * Get the Drizzle Postgres database instance.
   */
  public override get db(): PostgresJsDatabase {
    if (!this.pg) {
      throw new AlephaError("Database not initialized");
    }

    return this.pg;
  }

  protected override async runMigrator(
    migrationsFolder: string,
    options?: { init?: boolean },
  ): Promise<{ exitCode?: string } | void> {
    if (!this.needsDedicatedMigrationClient()) {
      return await migrate(this.db, {
        migrationsFolder,
        migrationsTable: this.migrationsTable,
        ...options,
      });
    }

    // Schema-free migration SQL resolves against `search_path`, and
    // postgres.js does not support the `connection` startup parameter with
    // pooled connections (Neon and friends), so it has to be SET explicitly.
    //
    // But `SET` followed by `migrate()` is two statements against a POOL:
    // postgres.js is free to hand the migration a different connection, one
    // that never saw the SET, and the tables land in `public` while the app
    // reads them from the configured schema. Migrations run once at boot and
    // are not a hot path, so they get their own single-connection client —
    // `max: 1` makes "the session that was SET" and "the session that
    // migrates" provably the same one.
    const client = postgres(this.migrationClientOptions());
    try {
      const db = drizzle({ client });
      await db.execute(sql.raw(`SET search_path TO ${this.schema}, public`));
      return await migrate(db, {
        migrationsFolder,
        migrationsTable: this.migrationsTable,
        ...options,
      });
    } finally {
      await client.end();
    }
  }

  /**
   * Whether migrations need a session-pinned connection — i.e. whether there
   * is a `search_path` to set at all.
   */
  protected needsDedicatedMigrationClient(): boolean {
    return this.schema !== "public";
  }

  /**
   * Client options for the migration-only connection: the app's connection
   * details, pinned to a single session. `max: 1` overrides any configured
   * `POOL_MAX` — that setting sizes the app's pool, and a pool is precisely
   * what must not be used here.
   */
  protected migrationClientOptions(): postgres.Options<any> {
    return { ...this.getClientOptions(), max: 1 };
  }

  // -------------------------------------------------------------------------------------------------------------------

  public async connect(): Promise<void> {
    const options = this.getClientOptions();

    this.log.debug("Connect ..", {
      ...options,
      password: options.password ? "****" : undefined, // hide password
    });

    const client = postgres(options);
    await client`SELECT 1`; // test connection

    this.client = client;
    this.pg = drizzle({
      client,
      logger: {
        // forward logs
        logQuery: (query: string, params: unknown[]) => {
          this.log.trace(query, { params });
        },
      },
    });

    this.log.info("Connection OK");
  }

  public async close(): Promise<void> {
    if (this.client) {
      this.log.debug("Close...");

      await this.client.end();

      this.client = undefined;
      this.pg = undefined;

      this.log.info("Connection closed");
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Map the DATABASE_URL to postgres client options.
   */
  protected getClientOptions(): postgres.Options<any> {
    const url = new URL(this.url);

    const options: postgres.Options<any> = {
      host: url.hostname,
      user: decodeURIComponent(url.username),
      database: decodeURIComponent(url.pathname.replace("/", "")),
      password: decodeURIComponent(url.password),
      port: Number(url.port || 5432),
      ssl: this.ssl(url),
      onnotice: () => {
        // let drizzle handle logs
      },
    };

    // Pool options — only set when explicitly configured via env vars
    if (this.pgEnv.POOL_MAX != null) options.max = this.pgEnv.POOL_MAX;
    if (this.pgEnv.POOL_IDLE_TIMEOUT != null)
      options.idle_timeout = this.pgEnv.POOL_IDLE_TIMEOUT;
    if (this.pgEnv.POOL_CONNECT_TIMEOUT != null)
      options.connect_timeout = this.pgEnv.POOL_CONNECT_TIMEOUT;

    // Set search_path at connection level so schema-free migration SQL
    // resolves to the correct PostgreSQL schema across all pool connections.
    if (this.schema !== "public") {
      options.connection = { search_path: `${this.schema}, public` };
    }

    return options;
  }

  protected ssl(
    url: URL,
  ): "require" | "allow" | "prefer" | "verify-full" | undefined {
    const mode = url.searchParams.get("sslmode");
    for (const it of NodePostgresProvider.SSL_MODES) {
      if (mode === it) {
        return it;
      }
    }
  }
}
