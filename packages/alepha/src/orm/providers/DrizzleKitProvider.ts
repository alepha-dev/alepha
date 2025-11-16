import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { $inject, Alepha, AlephaError, type Static, t } from "alepha";
import { $logger } from "alepha/logger";
import type * as DrizzleKit from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import type { DatabaseProvider } from "./drivers/DatabaseProvider.ts";

export class DrizzleKitProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);

  /**
   * Synchronize database with current schema definitions.
   *
   * In development mode, it will generate and execute migrations based on the current state.
   * In testing mode, it will generate migrations from scratch without applying them.
   *
   * Does nothing in production mode, you must handle migrations manually.
   */
  public async synchronize(provider: DatabaseProvider): Promise<void> {
    if (this.alepha.isProduction()) {
      this.log.warn("Synchronization skipped in production mode.");
      return;
    }

    if (provider.schema !== "public") {
      await this.createSchemaIfNotExists(provider, provider.schema);
    }

    const now = Date.now();

    if (this.alepha.isTest()) {
      // -------------------------------------------------------------------------------------------------------------
      // testing area, generate migrations from scratch - no need to push schema
      const { statements } = await this.generateMigration(provider);
      await this.executeStatements(statements, provider);
    } else {
      // -------------------------------------------------------------------------------------------------------------
      // development area, generate migrations based on the current state
      const entry = await this.loadDevMigrations(provider);
      const { statements, snapshot } = await this.generateMigration(
        provider,
        entry?.snapshot ? JSON.parse(entry.snapshot) : undefined,
      );
      await this.executeStatements(statements, provider, true);
      await this.saveDevMigrations(provider, snapshot, entry);
    }

    this.log.info(
      `Db '${provider.name}' synchronization OK [${Date.now() - now}ms]`,
    );
  }

  /**
   * Mostly used for testing purposes. You can generate SQL migration statements without executing them.
   */
  public async generateMigration(
    provider: DatabaseProvider,
    prevSnapshot?: any,
  ): Promise<{
    statements: string[];
    models: Record<string, unknown>;
    snapshot?: any;
  }> {
    // import Drizzle Kit API
    const kit = this.importDrizzleKit();

    // load all models related to the given database connection provider
    const models = this.getModels(provider);

    // generate and return migrations if there are models
    if (Object.keys(models).length > 0) {
      if (provider.dialect === "sqlite") {
        const prev = prevSnapshot ?? (await kit.generateSQLiteDrizzleJson({}));
        const curr = await kit.generateSQLiteDrizzleJson(models);
        return {
          models,
          statements: await kit.generateSQLiteMigration(prev, curr),
          snapshot: curr,
        };
      }

      const prev = prevSnapshot ?? (await kit.generateDrizzleJson({}));
      const curr = await kit.generateDrizzleJson(models);
      return {
        models,
        statements: await kit.generateMigration(prev, curr),
        snapshot: curr,
      };
    }

    return {
      models,
      statements: [],
      snapshot: {},
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Load all tables, enums, sequences, etc. from the provider's repositories.
   */
  public getModels(provider: DatabaseProvider): Record<string, unknown> {
    const models: Record<string, unknown> = {};
    for (const [key, value] of provider.tables.entries()) {
      if (models[key]) {
        throw new AlephaError(
          `Model name conflict: '${key}' is already defined.`,
        );
      }
      models[key] = value;
    }
    for (const [key, value] of provider.enums.entries()) {
      if (models[key]) {
        throw new AlephaError(
          `Model name conflict: '${key}' is already defined.`,
        );
      }
      models[key] = value;
    }
    for (const [key, value] of provider.sequences.entries()) {
      if (models[key]) {
        throw new AlephaError(
          `Model name conflict: '${key}' is already defined.`,
        );
      }
      models[key] = value;
    }
    return models;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Load the migration snapshot from the database.
   */
  protected async loadDevMigrations(
    provider: DatabaseProvider,
  ): Promise<DevMigrations | undefined> {
    const name =
      `${this.alepha.env.APP_NAME ?? "APP"}-${provider.constructor.name}`.toLowerCase();

    if (provider.url.includes(":memory:")) {
      this.log.trace(
        `In-memory database detected for '${name}', skipping migration snapshot load.`,
      );
      return;
    }

    if (provider.dialect === "sqlite") {
      try {
        const text = await readFile(
          `node_modules/.alepha/sqlite-${name}.json`,
          "utf-8",
        );
        return this.alepha.codec.decode(devMigrationsSchema, text);
      } catch (e) {
        this.log.trace(`No existing migration snapshot for '${name}'`, e);
      }
      return;
    }

    await provider.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle";`);
    await provider.execute(sql`
					CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_dev_migrations" (
						"id" SERIAL PRIMARY KEY,
						"name" TEXT NOT NULL,
						"created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"snapshot" TEXT NOT NULL
					);
				`);

    const rows = await provider.run(
      sql`SELECT * FROM "drizzle"."__drizzle_dev_migrations" WHERE "name" = ${name} LIMIT 1`,
      devMigrationsSchema,
    );

    if (rows.length === 0) {
      this.log.trace(`No existing migration snapshot for '${name}'`);
      return;
    }

    return this.alepha.codec.decode(devMigrationsSchema, rows[0]);
  }

  protected async saveDevMigrations(
    provider: DatabaseProvider,
    curr: Record<string, any>,
    devMigrations?: DevMigrations,
  ) {
    if (provider.url.includes(":memory:")) {
      this.log.trace(
        `In-memory database detected for '${provider.constructor.name}', skipping migration snapshot save.`,
      );
      return;
    }

    const name =
      `${this.alepha.env.APP_NAME ?? "APP"}-${provider.constructor.name}`.toLowerCase();
    if (provider.dialect === "sqlite") {
      const filePath = `node_modules/.alepha/sqlite-${name}.json`;
      await mkdir("node_modules/.alepha", { recursive: true }).catch(
        () => null,
      );
      await writeFile(
        filePath,
        JSON.stringify(
          {
            id: devMigrations?.id ?? 1,
            name,
            created_at: new Date(),
            snapshot: JSON.stringify(curr),
          },
          null,
          2,
        ),
      );
      this.log.debug(`Saved migration snapshot to '${filePath}'`);
      return;
    }

    if (!devMigrations) {
      await provider.execute(
        sql`INSERT INTO "drizzle"."__drizzle_dev_migrations" ("name", "snapshot") VALUES (${name}, ${JSON.stringify(curr)})`,
      );
    } else {
      const newSnapshot = JSON.stringify(curr);
      if (devMigrations.snapshot !== newSnapshot) {
        await provider.execute(
          sql`UPDATE "drizzle"."__drizzle_dev_migrations" SET "snapshot" = ${newSnapshot} WHERE "id" = ${devMigrations.id}`,
        );
      }
    }
  }

  protected async executeStatements(
    statements: string[],
    provider: DatabaseProvider,
    catchErrors = false,
  ) {
    let nErrors = 0;
    for (const statement of statements) {
      // skip drop schema statements to avoid accidental data loss
      if (statement.startsWith("DROP SCHEMA")) {
        continue;
      }

      try {
        await provider.execute(sql.raw(statement));
      } catch (error) {
        const errorMessage = `Error executing statement: ${statement}`;
        if (catchErrors) {
          nErrors++;
          this.log.warn(errorMessage, { context: [error] });
        } else {
          throw error;
        }
      }
    }
    if (nErrors > 0) {
      this.log.warn(
        `Executed ${statements.length} statements with ${nErrors} errors.`,
      );
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected async createSchemaIfNotExists(
    provider: DatabaseProvider,
    schemaName: string,
  ) {
    // Validate schema name to prevent SQL injection
    if (!/^[a-z0-9_]+$/i.test(schemaName)) {
      throw new Error(
        `Invalid schema name: ${schemaName}. Must only contain alphanumeric characters and underscores.`,
      );
    }

    const sqlSchema = sql.raw(schemaName);

    if (schemaName.startsWith("test_")) {
      this.log.info(`Drop test schema '${schemaName}' ...`, schemaName);
      await provider.execute(sql`DROP SCHEMA IF EXISTS ${sqlSchema} CASCADE`);
    }

    // create schema if not exists
    this.log.debug(`Ensuring schema '${schemaName}' exists`);
    await provider.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sqlSchema}`);
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Try to load the official Drizzle Kit API.
   * If not available, fallback to the local kit import.
   */
  protected importDrizzleKit(): typeof DrizzleKit {
    try {
      return createRequire(import.meta.url)("drizzle-kit/api");
    } catch (_) {
      throw new Error(
        "Drizzle Kit is not installed. Please install it with `npm install -D drizzle-kit`.",
      );
    }
  }
}

const devMigrationsSchema = t.object({
  id: t.number(),
  name: t.text(),
  snapshot: t.string(),
  created_at: t.string(),
});

type DevMigrations = Static<typeof devMigrationsSchema>;
