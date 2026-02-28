import { type Static, t } from "alepha";

/**
 * PostgreSQL-specific environment schema.
 *
 * Additional env vars for PostgreSQL providers on top of `databaseEnvSchema`.
 */
export const postgresEnvSchema = t.object({
  /**
   * PostgreSQL schema name (defaults to `"public"` when unset).
   */
  POSTGRES_SCHEMA: t.optional(t.text()),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof postgresEnvSchema>> {}
}
