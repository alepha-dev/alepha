import { createRequire } from "node:module";
import { $inject, Alepha, AlephaError } from "@alepha/core";
import { $logger } from "@alepha/logger";
import type * as DrizzleKit from "drizzle-kit/api";
import { sql, Table } from "drizzle-orm";
import { isPgEnum, isPgSequence } from "drizzle-orm/pg-core";
import { sqliteTable } from "drizzle-orm/sqlite-core";
import {
  $repository,
  type RepositoryDescriptor,
} from "../descriptors/$repository.ts";
import { $sequence } from "../descriptors/$sequence.ts";
import { schemaToSqliteColumns } from "../helpers/schemaToSqliteColumns.ts";
import type { PostgresProvider } from "./drivers/PostgresProvider.ts";

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
  public async synchronize(
    provider: PostgresProvider,
    schema?: string,
  ): Promise<void> {
    if (this.alepha.isProduction()) {
      this.log.warn("Synchronization skipped in production mode.");
      return;
    }

    const now = Date.now();

    // 1. load all models related to the given database connection provider
    const models = this.getModels(provider);

    // 2. if schema is not 'public', ensure it exists and rename all models
    if (schema && schema !== "public") {
      await this.ensurePgSchema(provider, schema);
      this.applyPgSchema(models, schema);
    }

    // 3. generate and execute migrations if there are models
    if (Object.keys(models).length > 0) {
      // import Drizzle Kit API
      const kit = this.importDrizzleKit();
      if (this.alepha.isTest()) {
        // -------------------------------------------------------------------------------------------------------------
        // testing area, generate migrations from scratch - no need to push schema
        const prev = kit.generateDrizzleJson({});
        const curr = kit.generateDrizzleJson(models);
        const statements = await kit.generateMigration(prev, curr);
        await this.executeStatements(statements, provider, schema);
      } else {
        // -------------------------------------------------------------------------------------------------------------
        // development area, generate migrations based on the current state
        const entry = await this.loadDevMigrations(provider);
        const prev = entry
          ? JSON.parse(entry.snapshot)
          : kit.generateDrizzleJson({});

        const curr = kit.generateDrizzleJson(models);
        const statements = await kit.generateMigration(prev, curr);
        await this.executeStatements(statements, provider, schema, true);
        await this.saveDevMigrations(provider, curr, entry);
      }
    }

    this.log.info(`Synchronization executed in ${Date.now() - now}ms`);
  }

  /**
   * Mostly used for testing purposes. You can generate SQL migration statements without executing them.
   */
  public generateMigration(
    provider: PostgresProvider,
    schema?: string,
  ): Promise<string[]> {
    // import Drizzle Kit API
    const kit = this.importDrizzleKit();

    // load all models related to the given database connection provider
    const models = this.getModels(provider);

    // if schema is not 'public', ensure it exists and rename all models
    if (schema && schema !== "public") {
      this.applyPgSchema(models, schema);
    }

    // generate and return migrations if there are models
    if (Object.keys(models).length > 0) {
      const prev = kit.generateDrizzleJson({});
      const curr = kit.generateDrizzleJson(models);
      return kit.generateMigration(prev, curr);
    }

    return Promise.resolve([]);
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Get all repositories from the provider.
   */
  public getRepositories(
    provider?: PostgresProvider,
  ): Array<RepositoryDescriptor> {
    const repositories: {
      [name: string]: RepositoryDescriptor;
    } = {};

    for (const it of this.alepha.descriptors($repository)) {
      if (!provider || it.provider === provider) {
        repositories[it.tableName] = it;
      }
    }

    return Object.values(repositories);
  }

  /**
   * Load all tables, enums, sequences, etc. from the provider's repositories.
   */
  public getModels(provider?: PostgresProvider): Record<string, unknown> {
    const models: Record<string, unknown> = {};

    Object.assign(models, this.getTables(provider));
    Object.assign(models, this.getSequences(provider));

    return models;
  }

  /**
   * Load all sequences from the provider's repositories.
   */
  public getSequences(provider?: PostgresProvider): Record<string, unknown> {
    const sequences: Record<string, unknown> = {};

    for (const it of this.alepha.descriptors($sequence)) {
      if (!provider || it.provider === provider) {
        sequences[it.name] = it.model;
      }
    }

    return sequences;
  }

  /**
   * Get all tables from the provider's repositories.
   */
  public getTables(provider?: PostgresProvider): Record<string, unknown> {
    const tables: Record<string, unknown> = {};

    const repositories = this.getRepositories(provider);

    const enumValuesCache: { [name: string]: string } = {};

    for (const repository of repositories) {
      tables[repository.tableName] = repository.options.table;
      if (repository.options.table.registry) {
        for (const [name, model] of repository.options.table.registry) {
          // for enums, just check if already exists with same values
          if (isPgEnum(model)) {
            // don't sort, order matters
            const values = model.enumValues.join(",");
            if (enumValuesCache[name]) {
              if (enumValuesCache[name] !== values) {
                throw new AlephaError(
                  `Enum name conflict '${name}': values [${enumValuesCache[name]}] vs [${values}]`,
                );
              }
            }

            enumValuesCache[name] = values;
          }

          tables[name] = model;
        }
      }
    }

    return tables;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Load the migration snapshot from the database.
   */
  protected async loadDevMigrations(provider: PostgresProvider) {
    const app = this.alepha.env.APP_NAME ?? "app";
    await provider.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle";`);
    await provider.execute(sql`
					CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_dev_migrations" (
						"id" SERIAL PRIMARY KEY,
						"name" TEXT NOT NULL,
						"created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"snapshot" TEXT NOT NULL
					);
				`);

    const rows = await provider.execute(sql`
			SELECT * FROM "drizzle"."__drizzle_dev_migrations" WHERE "name" = ${app} LIMIT 1;
		`);

    return rows[0];
  }

  protected async saveDevMigrations(
    provider: PostgresProvider,
    curr: Record<string, any>,
    entry?: { id: number; snapshot: string },
  ) {
    const app = this.alepha.env.APP_NAME ?? "app";
    if (!entry) {
      await provider.execute(
        sql`INSERT INTO "drizzle"."__drizzle_dev_migrations" ("name", "snapshot") VALUES (${app}, ${JSON.stringify(curr)})`,
      );
    } else {
      const newSnapshot = JSON.stringify(curr);
      if (entry.snapshot !== newSnapshot) {
        await provider.execute(
          sql`UPDATE "drizzle"."__drizzle_dev_migrations" SET "snapshot" = ${newSnapshot} WHERE "id" = ${entry.id}`,
        );
      }
    }
  }

  protected async executeStatements(
    statements: string[],
    provider: PostgresProvider,
    _schema?: string,
    catchErrors = false,
  ) {
    let nErrors = 0;
    for (const statement of statements) {
      if (statement.startsWith("DROP SCHEMA")) {
        continue; // skip dropping schema statements
      }
      try {
        await provider.db.execute(sql.raw(statement));
      } catch (error) {
        const errorMessage = `Error executing statement: ${statement}`;
        if (catchErrors) {
          nErrors++;
          this.log.warn(errorMessage, { context: [error] });
        } else {
          throw new Error(errorMessage, {
            cause: error,
          });
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

  protected async ensurePgSchema(
    provider: PostgresProvider,
    schemaName: string,
  ) {
    const sqlSchema = sql.raw(schemaName);

    if (schemaName.startsWith("test_")) {
      this.log.info(`Drop test schema '${schemaName}' ...`, schemaName);
      await provider.execute(sql`DROP SCHEMA IF EXISTS ${sqlSchema} CASCADE`);
    }

    // create schema if not exists
    this.log.info(`Ensuring schema '${schemaName}' exists`);
    await provider.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sqlSchema}`);
  }

  /**
   * Apply the given PostgreSQL schema to all models.
   *
   * TODO: cloning for avoid mutating original models?
   */
  public applyPgSchema(models: Record<string, any>, schema?: string): void {
    if (!schema || schema === "public") {
      return; // no need to set schema if it's public or not defined
    }

    // update all tables, enums, views, etc. with the new schema
    for (const modelName in models) {
      this.log.trace(`Force schema '${schema}' for model '${modelName}'`);
      const model = models[modelName];
      if (isPgSequence(model)) {
        (model as any).schema = schema;
      } else if (isPgEnum(model)) {
        (model as any).schema = schema;
      } else {
        model[(Table as any).Symbol.Schema] = schema;
      }
    }
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

  // -------------------------------------------------------------------------------------------------------------------

  public async synchronizeSqlite(provider: PostgresProvider): Promise<void> {
    const repositories = this.getRepositories(provider);
    const tables: Record<string, any> = {};

    for (const repository of repositories) {
      // extract TypeBox schema and convert it to SQLite columns
      const table = sqliteTable(
        repository.tableName,
        schemaToSqliteColumns(repository.schema) as any,
      );
      // then, swap the PG Table with the SQLite one (yes)
      (repository as any).options.table = table;
      tables[repository.tableName] = table;
    }

    if (Object.keys(tables).length > 0) {
      const kit = this.importDrizzleKit();
      const curr = await kit.generateSQLiteDrizzleJson(tables);
      const prev = await kit.generateSQLiteDrizzleJson({});
      const statements = await kit.generateSQLiteMigration(prev, curr);

      for (const statement of statements) {
        if ("run" in provider.db && typeof provider.db.run === "function") {
          const statementFixed = statement.replace(
            "CREATE TABLE",
            "CREATE TABLE IF NOT EXISTS",
          );

          await provider.db.run(sql.raw(statementFixed));
        }
      }
    }
  }
}
