import { type Static, z } from "alepha";

/**
 * PostgreSQL-specific environment schema.
 *
 * Additional env vars for PostgreSQL providers on top of `databaseEnvSchema`.
 */
export const postgresEnvSchema = z.object({
  /**
   * PostgreSQL schema name (defaults to `"public"` when unset).
   */
  POSTGRES_SCHEMA: z.text().optional(),

  /**
   * Maximum number of connections in the pool.
   */
  POOL_MAX: z.integer().optional(),

  /**
   * Seconds a connection can be idle before being closed.
   */
  POOL_IDLE_TIMEOUT: z.integer().optional(),

  /**
   * Seconds to wait when establishing a new connection.
   */
  POOL_CONNECT_TIMEOUT: z.integer().optional(),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof postgresEnvSchema>> {}
}
