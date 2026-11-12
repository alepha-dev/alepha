import { type Infer, z } from "alepha";

/**
 * Base database environment schema.
 *
 * Defines the `DATABASE_URL` connection string used by all ORM providers
 * to determine the database driver and connection target.
 *
 * Supported URL formats:
 * - a file path, `:memory:`, `sqlite://./path/to/db` or `file:` - SQLite (Node.js or Bun)
 * - `postgres://user:password@host:port/database` or `postgresql://...` - PostgreSQL (Node.js or Bun)
 * - `d1://BINDING_NAME` - Cloudflare D1
 * - `hyperdrive://BINDING_NAME` - Cloudflare Hyperdrive
 *
 * Any other scheme is refused (`DbUrlError`).
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
   * `$transactional()` then runs its body in place (D1 itself refuses the
   * block unless it declares `allowNonAtomic`), `afterCommit` callbacks
   * run at once and `Repository.transaction()` throws. A spec that sets it
   * sees D1's interleaving and its partial writes, which the SQLite drivers
   * otherwise hide by serializing every transaction.
   *
   * Honoured only when `NODE_ENV` is `test`: it can never switch
   * transactions off in production.
   */
  DATABASE_TRANSACTIONS: z.boolean().meta({ secret: false }).optional(),

  /**
   * Test-only: `postgres` runs a suite written for SQLite on Postgres.
   *
   * A spec whose `DATABASE_URL` is unset or an in-memory SQLite one then
   * gets the server `POSTGRES_TEST_URL` names instead, in a schema of its
   * own; a spec that names a file, D1 or Postgres keeps it. `alepha test
   * --dialect postgres` sets it. Honoured only when `NODE_ENV` is `test`.
   */
  DATABASE_TEST_DIALECT: z
    .enum(["sqlite", "postgres"])
    .meta({ secret: false })
    .optional(),

  /**
   * Milliseconds a query may take before it fails with `DbTimeoutError`
   * (503), on every driver. `0` disables it. Defaults to 5000 on serverless,
   * off elsewhere. A statement's own `timeout` wins.
   *
   * What a timeout stops depends on the driver: postgres cancels the running
   * statement, D1 abandons it (it cannot abort), and SQLite, which runs a
   * statement synchronously, only refuses one not yet sent.
   */
  DATABASE_TIMEOUT: z
    .number()
    .meta({ secret: false })
    .optional()
    .describe(
      "Milliseconds a query may take before it fails with DbTimeoutError. 0 disables. Defaults to 5000 on serverless, off elsewhere.",
    ),

  /**
   * Whether `DATABASE_TIMEOUT` governs every statement (`all`, the default)
   * or reads only (`reads`). A statement's own `timeout` applies either way.
   */
  DATABASE_TIMEOUT_SCOPE: z
    .enum(["all", "reads"])
    .meta({ secret: false })
    .optional()
    .describe(
      "Whether DATABASE_TIMEOUT governs every statement ('all', default) or only reads ('reads').",
    ),
});

declare module "alepha" {
  interface Env extends Partial<Infer<typeof databaseEnvSchema>> {}
}
