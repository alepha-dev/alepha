import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import {
  $atom,
  $env,
  $hook,
  $inject,
  $use,
  AlephaError,
  type Static,
  t,
} from "alepha";
import { $logger } from "alepha/logger";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { SqliteModelBuilder } from "../../services/SqliteModelBuilder.ts";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";
import { DatabaseProvider, type SQLLike } from "./DatabaseProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  DATABASE_URL: t.optional(t.text()),
});

/**
 * Configuration options for the Bun SQLite database provider.
 */
export const bunSqliteOptions = $atom({
  name: "alepha.postgres.bun-sqlite.options",
  schema: t.object({
    path: t.optional(
      t.string({
        description:
          "Filepath or :memory:. If empty, provider will use DATABASE_URL from env.",
      }),
    ),
  }),
  default: {},
});

export type BunSqliteProviderOptions = Static<typeof bunSqliteOptions.schema>;

declare module "alepha" {
  interface State {
    [bunSqliteOptions.key]: BunSqliteProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Bun SQLite provider using Drizzle ORM with Bun's native SQLite client.
 *
 * This provider uses Bun's built-in `bun:sqlite` for SQLite connections,
 * which provides excellent performance on the Bun runtime.
 *
 * @example
 * ```ts
 * // Set DATABASE_URL environment variable
 * // DATABASE_URL=sqlite://./my-database.db
 *
 * // Or configure programmatically
 * alepha.with({
 *   provide: DatabaseProvider,
 *   use: BunSqliteProvider,
 * });
 *
 * // Or use options atom
 * alepha.store.mut(bunSqliteOptions, (old) => ({
 *   ...old,
 *   path: ":memory:",
 * }));
 * ```
 */
export class BunSqliteProvider extends DatabaseProvider {
  protected readonly kit = $inject(DrizzleKitProvider);
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly builder = $inject(SqliteModelBuilder);
  protected readonly options = $use(bunSqliteOptions);

  protected sqlite?: Database;
  protected bunDb?: BunSQLiteDatabase;

  public get name() {
    return "bun-sqlite";
  }

  public override readonly dialect = "sqlite";

  public override get url(): string {
    const path = this.options.path ?? this.env.DATABASE_URL;
    if (path) {
      if (path.startsWith("postgres://")) {
        throw new AlephaError(
          "Postgres URL is not supported for SQLite provider.",
        );
      }
      return path;
    }

    if (this.alepha.isTest() || this.alepha.isServerless()) {
      return ":memory:";
    } else {
      return "node_modules/.alepha/bun-sqlite.db";
    }
  }

  public override get db(): PgDatabase<any> {
    if (!this.bunDb) {
      throw new AlephaError("Database not initialized");
    }

    return this.bunDb as unknown as PgDatabase<any>;
  }

  public override async execute(
    query: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    return (this.bunDb as BunSQLiteDatabase).all(query);
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      // Check if we're running in Bun
      if (typeof Bun === "undefined") {
        throw new AlephaError(
          "BunSqliteProvider requires the Bun runtime. Use NodeSqliteProvider for Node.js.",
        );
      }

      const { Database } = await import("bun:sqlite");
      const { drizzle } = await import("drizzle-orm/bun-sqlite");

      const filepath = this.url.replace("sqlite://", "").replace("sqlite:", "");

      if (filepath !== ":memory:" && filepath !== "") {
        const dirname = filepath.split("/").slice(0, -1).join("/");
        if (dirname) {
          await mkdir(dirname, { recursive: true }).catch(() => null);
        }
      }

      this.sqlite = new Database(filepath);

      this.bunDb = drizzle({
        client: this.sqlite,
        logger: {
          logQuery: (query: string, params: unknown[]) => {
            this.log.trace(query, { params });
          },
        },
      });

      await this.migrate();

      this.log.info(`Using Bun SQLite database at ${filepath}`);
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      if (this.sqlite) {
        this.log.debug("Closing Bun SQLite connection...");
        this.sqlite.close();
        this.sqlite = undefined;
        this.bunDb = undefined;
        this.log.info("Bun SQLite connection closed");
      }
    },
  });

  protected async executeMigrations(migrationsFolder: string): Promise<void> {
    const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
    await migrate(this.bunDb!, { migrationsFolder });
  }
}
