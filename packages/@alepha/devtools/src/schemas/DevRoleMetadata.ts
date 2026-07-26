import { type Static, z } from "alepha";

export const devRoleMetadataSchema = z.object({
  /**
   * Role name, as declared by `$role({ name })` or derived from the property
   * key.
   */
  name: z.text(),
  description: z.text().optional(),
  /**
   * Realm the role belongs to. Roles live inside realms, and the same name can
   * exist in two realms with different grants.
   */
  realm: z.text().optional(),
  /**
   * True when the role is handed to every user automatically.
   */
  default: z.boolean().optional(),
  /**
   * Raw grants as written, wildcards included. The matrix resolves them; this
   * is what the developer typed.
   */
  grants: z.array(
    z.object({
      name: z.text(),
      ownership: z.boolean().optional(),
      exclude: z.array(z.text()).optional(),
    }),
  ),
  /**
   * Fully-resolved permission names this role can reach, wildcards expanded
   * and `exclude` applied — computed server-side by `SecurityProvider`, which
   * owns the matching rules. Recomputing them in the browser would be a second
   * implementation free to disagree with the one that actually guards
   * requests.
   */
  effective: z.array(z.text()),
  /**
   * Subset of `effective` reachable *only* through a wildcard grant — no
   * literal grant names them. These are the permissions a developer never
   * explicitly handed out, which is where over-granting hides.
   */
  viaWildcard: z.array(z.text()),
});

export type DevRoleMetadata = Static<typeof devRoleMetadataSchema>;
