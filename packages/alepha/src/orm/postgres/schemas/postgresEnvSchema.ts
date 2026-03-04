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

  /**
   * Maximum number of connections in the pool.
   */
  POOL_MAX: t.optional(t.integer()),

  /**
   * Seconds a connection can be idle before being closed.
   */
  POOL_IDLE_TIMEOUT: t.optional(t.integer()),

  /**
   * Seconds to wait when establishing a new connection.
   */
  POOL_CONNECT_TIMEOUT: t.optional(t.integer()),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof postgresEnvSchema>> {}
}
