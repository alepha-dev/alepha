import { DbError } from "./DbError.ts";

/**
 * Migrations failed to apply at boot.
 */
export const DbMigrationError = DbError.extend({
  name: "DB_MIGRATION",
  message: "Failed to migrate database",
});

export type DbMigrationError = InstanceType<typeof DbMigrationError>;
