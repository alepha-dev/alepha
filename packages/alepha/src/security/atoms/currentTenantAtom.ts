import { $atom, z } from "alepha";

/**
 * Atom storing the active tenant for the current request.
 *
 * Transport-agnostic — works with HTTP, MCP, pipelines, jobs, and any context
 * that sets the atom before calling tenant-scoped logic.
 *
 * Typically set by an app-level middleware that resolves the tenant from the
 * request `Host` header (or another signal) and writes the resolved id to the
 * store. Framework code that reads this atom:
 *
 * - Repository scoping: `withOrganization` / `stampOrganization` prefer this
 *   value over `currentUserAtom.organization` so cross-tenant users (admins,
 *   agency operators) are scoped to the tenant they are currently acting in
 *   rather than the one they belong to.
 * - Session creation: the value is persisted into the JWT as a `tenant` claim,
 *   and the issuer resolver rejects tokens whose claim does not match the
 *   tenant resolved from the current request.
 *
 * `id` is a free-form string so the framework stays neutral on tenant identity
 * (slug, UUID, composite). Pick whatever matches the column marked with
 * `PG_ORGANIZATION` in your entities.
 */
export const currentTenantAtom = $atom({
  name: "alepha.security.tenant",
  schema: z
    .object({
      id: z.text({
        description: "Tenant identifier (slug, UUID, or composite).",
      }),
    })
    .optional(),
});
