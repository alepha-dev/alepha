import { AlephaError } from "alepha";
import { sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";

import { PostgresProvider } from "./PostgresProvider.ts";

/**
 * Bun PostgreSQL provider using Drizzle ORM with Bun's native SQL client.
 *
 * This provider uses Bun's built-in SQL class for PostgreSQL connections,
 * which provides excellent performance on the Bun runtime.
 *
 * @example
 * ```ts
 * // Set DATABASE_URL environment variable
 * // DATABASE_URL=postgres://user:password@localhost:5432/database
 *
 * // Or configure programmatically
 * alepha.with({
 *   provide: DatabaseProvider,
 *   use: BunPostgresProvider,
 * });
 * ```
 */
export class BunPostgresProvider extends PostgresProvider {
  protected client?: Bun.SQL;
  protected bunDb?: BunSQLDatabase;

  /**
   * Get the Drizzle Postgres database instance.
   */
  public override get db(): PgAsyncDatabase<any> {
    if (!this.bunDb) {
      throw new AlephaError("Database not initialized");
    }

    return this.bunDb as unknown as PgAsyncDatabase<any>;
  }

  protected override async runMigrator(
    migrationsFolder: string,
    options?: { init?: boolean },
  ): Promise<{ exitCode?: string } | void> {
    if (this.schema !== "public") {
      await this.db.execute(
        sql.raw(`SET search_path TO ${this.schema}, public`),
      );
    }
    const { migrate } = await import("drizzle-orm/bun-sql/migrator");
    return await migrate(this.bunDb!, {
      migrationsFolder,
      migrationsTable: this.migrationsTable,
      ...options,
    });
  }

  // -------------------------------------------------------------------------------------------------------------------

  public async connect(): Promise<void> {
    this.log.debug("Connect ..");

    // Check if we're running in Bun
    if (typeof Bun === "undefined") {
      throw new AlephaError(
        "BunPostgresProvider requires the Bun runtime. Use NodePostgresProvider for Node.js.",
      );
    }

    const { drizzle } = await import("drizzle-orm/bun-sql/postgres");

    // Create Bun SQL client with pool options.
    //
    // `search_path` is set through libpq's `options` parameter, which is a
    // real connection-string keyword applied to every connection the pool
    // opens. A bare `?search_path=…` was not: libpq has no such keyword, so
    // it was parsed as an unknown parameter and dropped, and every pooled
    // connection kept the server's default search_path while the app
    // believed it was scoped to its schema.
    let connectionUrl = this.url;
    if (this.schema !== "public") {
      const separator = connectionUrl.includes("?") ? "&" : "?";
      const searchPath = encodeURIComponent(
        `-c search_path=${this.schema},public`,
      );
      connectionUrl += `${separator}options=${searchPath}`;
    }
    const bunOptions: Record<string, any> = { url: connectionUrl };
    if (this.pgEnv.POOL_MAX != null) {
      bunOptions.max = this.pgEnv.POOL_MAX;
    }
    if (this.pgEnv.POOL_IDLE_TIMEOUT != null) {
      bunOptions.idleTimeout = this.pgEnv.POOL_IDLE_TIMEOUT;
    }
    if (this.pgEnv.POOL_CONNECT_TIMEOUT != null) {
      bunOptions.connectionTimeout = this.pgEnv.POOL_CONNECT_TIMEOUT;
    }
    this.client = new Bun.SQL(bunOptions);

    // Test connection
    await this.client.unsafe("SELECT 1");

    this.bunDb = drizzle({
      client: this.client,
      logger: {
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

      await this.client.close();

      this.client = undefined;
      this.bunDb = undefined;

      this.log.info("Connection closed");
    }
  }
}
