import { $env, $hook, $inject, AlephaError, AlsProvider, z } from "alepha";
import { DatabaseProvider, type SQLLike } from "alepha/orm";
import { sql } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
import { PostgresModelBuilder } from "../services/PostgresModelBuilder.ts";

/**
 * ALS key under which the per-request drizzle instance is memoised.
 */
const HYPERDRIVE_DB_ALS_KEY = "alepha.orm.hyperdrive.db";

/**
 * Cloudflare Hyperdrive PostgreSQL provider using Drizzle ORM.
 *
 * Connects to an external PostgreSQL database through Cloudflare Hyperdrive,
 * which provides connection pooling and caching at the edge.
 *
 * Creates a fresh connection per request, since Cloudflare Workers
 * cannot reuse I/O objects across request contexts.
 *
 * URL format: hyperdrive://BINDING_NAME
 */
export class CloudflareHyperdriveProvider extends DatabaseProvider {
  protected readonly builder = $inject(PostgresModelBuilder);
  protected readonly als = $inject(AlsProvider);
  protected readonly env = $env(
    z.object({
      DATABASE_URL: z.string().describe("Expect to be 'hyperdrive://BINDING'"),
      POSTGRES_SCHEMA: z.text().optional(),
    }),
  );

  public override get schema(): string {
    return this.env.POSTGRES_SCHEMA ?? "public";
  }

  protected postgresFn?: any;
  protected drizzleFn?: any;
  protected bindingName?: string;

  public get name() {
    return "postgres";
  }

  public get driver() {
    return "hyperdrive";
  }

  public override readonly dialect = "postgresql";

  public override get url(): string {
    return this.env.DATABASE_URL;
  }

  /**
   * Get a fresh Drizzle instance per request.
   *
   * Reads the current Hyperdrive binding from `cloudflare.env`
   * and creates a new postgres client each time, avoiding the
   * "Cannot perform I/O on behalf of a different request" error.
   */
  public override get db(): PgAsyncDatabase<any> {
    if (!this.postgresFn || !this.drizzleFn || !this.bindingName) {
      throw new AlephaError("Hyperdrive database not initialized");
    }

    const cloudflareEnv = this.alepha.get("cloudflare.env") as
      | Record<string, unknown>
      | undefined;
    if (!cloudflareEnv) {
      throw new AlephaError(
        "Cloudflare Workers environment not found in Alepha store under 'cloudflare.env'.",
      );
    }

    const binding = cloudflareEnv[this.bindingName] as
      | { connectionString: string }
      | undefined;
    if (!binding?.connectionString) {
      throw new AlephaError(
        `Hyperdrive binding '${this.bindingName}' not found in Cloudflare Workers environment.`,
      );
    }

    const pgOptions: Record<string, any> = { prepare: false };

    // Set search_path so schema-free migration SQL resolves to the correct schema.
    if (this.schema !== "public") {
      pgOptions.connection = { search_path: `${this.schema}, public` };
    }

    // Memoised for the lifetime of the REQUEST, not the process and not the
    // access. A fresh client per request is deliberate — Workers refuse to
    // reuse an I/O object across request contexts ("Cannot perform I/O on
    // behalf of a different request") — but this getter is touched at least
    // once per repository call, so a handler running five queries used to
    // open five postgres clients that could not share a statement cache.
    //
    // The ALS fork IS the request boundary, so caching there is scoped
    // exactly right: no fork (migrations, tests, scripts) means no boundary
    // to be safe within, and we fall back to the old create-every-time
    // behaviour rather than risk leaking one context's client into the next.
    //
    // Nothing calls `client.end()`: the Worker's I/O context is destroyed
    // with the request and takes its sockets with it, and there is no
    // fork-teardown hook to hang a close on. Bounding the count at one per
    // request is what actually mattered.
    const cacheKey = `${HYPERDRIVE_DB_ALS_KEY}:${this.bindingName}`;
    if (this.als.exists()) {
      const cached = this.als.get<PgAsyncDatabase<any>>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const client = this.postgresFn(binding.connectionString, pgOptions);
    // drizzle-orm/postgres-js v1's `drizzle()` no longer binds an
    // already-connected client when passed positionally — only the object
    // form does (see NodePostgresProvider for the same fix). Passing the
    // client positionally here would compile (both args are `any`) but
    // silently open a *new*, unconfigured connection instead of reusing
    // this one.
    const db = this.drizzleFn({
      client,
    }) as unknown as PgAsyncDatabase<any>;

    if (this.als.exists()) {
      this.als.set(cacheKey, db);
    }

    return db;
  }

  public override async execute(
    query: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    return this.db.execute(query);
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      this.bindingName = this.env.DATABASE_URL.replace("hyperdrive://", "");

      // Pre-load modules so db getter is synchronous
      const pgModule = await import("postgres");
      const drizzleModule = await import("drizzle-orm/postgres-js");
      this.postgresFn = pgModule.default ?? pgModule;
      this.drizzleFn = drizzleModule.drizzle;

      this.log.info("Using Cloudflare Hyperdrive (PostgreSQL)");
    },
  });

  protected async executeMigrations(migrationsFolder: string): Promise<void> {
    this.log.debug(`Running Postgres migrations from '${migrationsFolder}'...`);
    try {
      if (this.schema !== "public") {
        await this.db.execute(
          sql.raw(`SET search_path TO ${this.schema}, public`),
        );
      }
      const { migrate } = await import("drizzle-orm/postgres-js/migrator");
      await migrate(this.db as any, {
        migrationsFolder,
        migrationsTable: this.migrationsTable,
      });
      this.log.debug("Postgres migrations completed successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      throw new AlephaError(
        `Postgres migration failed from '${migrationsFolder}': ${errorMessage}`,
        { cause: error },
      );
    }
  }
}
