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

  protected override async executeMigrations(
    migrationsFolder: string,
  ): Promise<void> {
    // Set search_path so schema-free migration SQL resolves to the correct schema.
    // postgres.js doesn't support the `connection` startup parameter with pooled
    // connections (e.g. Neon), so we SET it explicitly before running migrations.
    if (this.schema !== "public") {
      await this.db.execute(
        sql.raw(`SET search_path TO ${this.schema}, public`),
      );
    }
    await migrate(this.db, {
      migrationsFolder,
      migrationsTable: this.migrationsTable,
    });
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
    this.pg = drizzle(client, {
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
