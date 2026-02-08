import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
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
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import { SqliteModelBuilder } from "../../services/SqliteModelBuilder.ts";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";
import { DatabaseProvider, type SQLLike } from "./DatabaseProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

// HACK - Hide ExperimentalWarning about SQLite from Node.js to avoid spamming logs
// TODO: Remove when SQLite support is stable in Node.js

(() => {
  if (process?.emit) {
    const originalEmit = process.emit;
    process.emit = (event: any, warning: any, ...args: any[]) => {
      if (
        event === "warning" &&
        warning?.name === "ExperimentalWarning" &&
        warning?.message?.includes("SQLite")
      ) {
        return false;
      }
      return originalEmit.apply(process, [event, warning, ...args]);
    };
  }
})();

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  DATABASE_URL: t.optional(t.text()),
});

/**
 * Configuration options for the Node.js SQLite database provider.
 */
export const nodeSqliteOptions = $atom({
  name: "alepha.postgres.node-sqlite.options",
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

export type NodeSqliteProviderOptions = Static<typeof nodeSqliteOptions.schema>;

declare module "alepha" {
  interface State {
    [nodeSqliteOptions.key]: NodeSqliteProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Add a fake support for SQLite in Node.js based on Postgres interfaces.
 *
 * This is NOT a real SQLite provider, it's a workaround to use SQLite with Drizzle ORM.
 * This is NOT recommended for production use.
 */
export class NodeSqliteProvider extends DatabaseProvider {
  protected readonly kit = $inject(DrizzleKitProvider);
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly builder = $inject(SqliteModelBuilder);
  protected readonly options = $use(nodeSqliteOptions);

  protected sqlite!: DatabaseSync;

  public get name() {
    return "sqlite";
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
      return "node_modules/.alepha/sqlite.db";
    }
  }

  public override async execute(
    query: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    const all = (this.db as unknown as SqliteRemoteDatabase).all(query);
    const { sql, params, method } = all.getQuery();

    const start = performance.now();
    let result: Array<Record<string, unknown>> = [];

    try {
      const statement = this.sqlite.prepare(sql);
      if (method === "run") {
        statement.run(...(params as any[]));
        result = [];
      } else if (method === "get") {
        const data = statement.get(...(params as any[]));
        result = data ? [{ ...data }] : [];
      } else {
        result = statement.all(...(params as any[]));
      }

      this.logQuery(
        sql,
        params as unknown[],
        performance.now() - start,
        result.length,
      );
      return result;
    } catch (error) {
      this.logQuery(
        sql,
        params as unknown[],
        performance.now() - start,
        0,
        (error as Error).message,
      );
      throw error;
    }
  }

  public readonly db = drizzle(async (sql, params, method) => {
    const start = performance.now();
    const statement = this.sqlite.prepare(sql);

    try {
      if (method === "get") {
        const data = statement.get(...params);
        const rows = data ? [{ ...data }] : [];
        this.logQuery(sql, params, performance.now() - start, rows.length);
        return { rows };
      }

      if (method === "run") {
        statement.run(...params);
        this.logQuery(sql, params, performance.now() - start, 0);
        return { rows: [] };
      }

      if (method === "all") {
        const rows = statement.all(...params);
        this.logQuery(sql, params, performance.now() - start, rows.length);
        return {
          rows: rows.map((row) => Object.values(row)),
        };
      }

      if (method === "values") {
        const rows = statement.all(...params);
        this.logQuery(sql, params, performance.now() - start, rows.length);
        return {
          rows: rows.map((row) => Object.values(row)),
        };
      }

      throw new AlephaError(`Unsupported method: ${method}`);
    } catch (error) {
      this.logQuery(
        sql,
        params,
        performance.now() - start,
        0,
        (error as Error).message,
      );
      throw error;
    }
  }) as unknown as PgDatabase<any>;

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      const { DatabaseSync } = await import("node:sqlite");

      const filepath = this.url.replace("sqlite://", "").replace("sqlite:", "");

      if (filepath !== ":memory:" && filepath !== "") {
        const dir = dirname(filepath);
        if (dir) {
          await mkdir(dir, { recursive: true }).catch(() => null);
        }
      }

      this.sqlite = new DatabaseSync(filepath);

      // Never migrate in serverless mode - migrations should be applied during deployment
      if (!this.alepha.isServerless()) {
        await this.migrate();
      }

      this.log.info(`SQLite database OK`, { at: filepath });
    },
  });

  protected async executeMigrations(migrationsFolder: string): Promise<void> {
    await migrate(
      this.db as unknown as SqliteRemoteDatabase,
      async (migrationQueries: string[]) => {
        this.log.debug("Executing migration queries", { migrationQueries });
        for (const query of migrationQueries) {
          this.sqlite.prepare(query).run();
        }
      },
      { migrationsFolder },
    );
  }
}
