export * from "drizzle-orm";
export * from "drizzle-orm/pg-core";
// Both modules declare these; pg-core's are the ones a Postgres query uses.
export type {
  SelectedFields,
  SelectedFieldsFlat,
  SelectedFieldsOrdered,
  TableConfig,
} from "drizzle-orm/pg-core";
export * from "./services/Drizzle.ts";
export * from "./types/SchemaToTableConfig.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The escape hatch from `alepha/orm` to drizzle itself.
 *
 * ⚠️ Outside semver. It re-exports `drizzle-orm` and `drizzle-orm/pg-core`
 * as the pinned drizzle release defines them, and {@link Drizzle} gives the
 * drizzle table, database and transaction behind a repository. A drizzle
 * upgrade can change any of it in a minor version of Alepha. `sql` and `SQL`
 * are the exception: `alepha/orm` re-exports them and keeps them stable.
 *
 * @module alepha.orm.drizzle
 */
