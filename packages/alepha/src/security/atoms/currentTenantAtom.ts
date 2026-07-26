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
 *
 * **`serverOnly`.** Unlike every other config atom, this one really is written
 * inside the request (that is the whole point), so without the flag the
 * resolved tenant would land in the SSR hydration payload of every page. It is
 * server-resolution state — which tenant the request was scoped to, and the
 * value the JWT `tenant` claim is checked against — not view state. A browser
 * that needs to know the current tenant should be told explicitly (an API
 * field, or a dedicated app-owned atom), not by reading the framework's
 * authorization input. See {@link currentUserAtom}, which is deliberately NOT
 * `serverOnly`: it is what `useAuth` hydrates from.
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
  serverOnly: true,
});
