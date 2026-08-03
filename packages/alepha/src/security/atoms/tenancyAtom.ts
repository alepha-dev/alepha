import { $atom, z } from "alepha";

/**
 * Whether this deployment serves several tenants, and therefore whether
 * tenant scoping is allowed to fail open.
 *
 * ### Why this is application config and not an entity option
 *
 * `db.organization({ strict: true })` has existed for a while and does the
 * right thing — but it is declared per entity, in framework code an
 * application cannot edit. So every framework-owned table (`users`, `files`,
 * `audits`, `parameters`, `apiKeys`, the payment tables) is non-strict, and a
 * query issued with no resolved tenant runs **unfiltered**. A `$job` or an
 * admin script that forgets to set {@link currentTenantAtom} reads and writes
 * across tenants on those tables.
 *
 * Whether that is acceptable is a fact about the *application*, not about the
 * `users` table. Every downstream multi-tenant app ended up writing the same
 * Host→tenant middleware that fails closed, which is the tell: the default was
 * on the wrong side, and the knob was in the wrong place.
 *
 * ### The two modes
 *
 * - `"single"` (default) — **exactly the historical behaviour**, unchanged. A
 *   resolved tenant still scopes the query; no resolved tenant means no
 *   predicate, and rows with a NULL organization stay visible. Correct for an
 *   app that has one tenant, or none.
 * - `"multi"` — fail closed everywhere: a read or write against a
 *   tenant-scoped entity with no resolved tenant **throws** instead of running
 *   unfiltered, and the `OR organization IS NULL` escape is dropped so a
 *   scoped tenant never sees global rows.
 *
 * ```ts
 * // main.server.ts
 * alepha.set(tenancyAtom, { mode: "multi" });
 * ```
 *
 * One line, at the composition root, auditable at a glance — where eight
 * scattered per-entity flags were not.
 *
 * ### Per-entity `strict` is now an override
 *
 * `db.organization({ strict })` still wins when set explicitly, in both
 * directions:
 *
 * - `strict: true` — always fail closed, even in `"single"` mode. For a table
 *   that must never leak regardless of how the app is deployed.
 * - `strict: false` — never fail closed, even in `"multi"` mode. The escape
 *   hatch for a genuinely shared table (a reference list, a global catalogue)
 *   inside an otherwise strict application.
 * - omitted — follow the mode. This is the case for every framework entity,
 *   which is the point: the application decides.
 *
 * ### What this atom deliberately does NOT change
 *
 * **Column nullability.** `db.organization({ nullable })` stays declarative
 * and keeps driving migrations: a schema fact cannot be decided by a value
 * read at boot. `strict` used to imply `nullable: false`, which quietly
 * conflated a runtime policy with a DDL choice — the two are separated now.
 * Setting `mode: "multi"` never alters a generated migration.
 *
 * ### No boot-time check
 *
 * An earlier design had `"multi"` refuse to start when no tenant resolver was
 * registered. There is nothing to detect: a resolver is any code that writes
 * {@link currentTenantAtom} — a middleware, a hook, a job wrapper — and it
 * cannot be seen statically. Fail-closed *is* the check, and it fires on the
 * first unscoped query with a message naming the entity, which is a better
 * signal than a boot-time guess.
 */
export const tenancyAtom = $atom({
  name: "alepha.security.tenancy",
  schema: z.object({
    mode: z.enum(["single", "multi"]).meta({ mode: "text" }),
  }),
  default: { mode: "single" },
  serverOnly: true,
});
