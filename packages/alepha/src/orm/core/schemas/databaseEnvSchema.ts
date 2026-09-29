import { type Infer, z } from "alepha";

/**
 * Base database environment schema.
 *
 * Defines the `DATABASE_URL` connection string used by all ORM providers
 * to determine the database driver and connection target.
 *
 * Supported URL formats:
 * - `sqlite://:memory:` or `sqlite://./path/to/db` — SQLite (Node.js or Bun)
 * - `postgres://user:password@host:port/database` — PostgreSQL (Node.js or Bun)
 * - `pglite://:memory:` or `pglite://./path` — PGlite (embedded Postgres)
 * - `d1://BINDING_NAME` — Cloudflare D1
 * - `hyperdrive://BINDING_NAME` — Cloudflare Hyperdrive
 */
export const databaseEnvSchema = z.object({
  DATABASE_URL: z.text().optional(),

  /**
   * Enable or disable push-based schema synchronization (drizzle-kit push).
   *
   * Defaults to `true` in development and test, `false` in production.
   * Set to `false` in development to skip automatic schema sync
   * (e.g. when managing migrations manually).
   */
  DATABASE_SYNC: z.boolean().meta({ secret: false }).optional(),

  /**
   * Test-only: `false` runs the database without transactions, the way
   * Cloudflare D1 does.
   *
   * `$transactional()` then runs its body in place, `afterCommit` callbacks
   * run at once and `Repository.transaction()` throws. A spec that sets it
   * sees D1's interleaving and its partial writes, which the SQLite drivers
   * otherwise hide by serializing every transaction.
   *
   * Honoured only when `NODE_ENV` is `test`: it can never switch
   * transactions off in production.
   */
  DATABASE_TRANSACTIONS: z.boolean().meta({ secret: false }).optional(),
});

declare module "alepha" {
  interface Env extends Partial<Infer<typeof databaseEnvSchema>> {}
}
