import { type Infer, z } from "alepha";
import { permissionCatalogueSchema } from "alepha/security";

import { apiKeyExpiresInSchema } from "./apiKeyExpiresInSchema.ts";

/**
 * Everything a create dialog cannot know on its own, from `GET
 * /api-keys/options`: the expiry policy it must obey, and the permissions the
 * caller may put in a key's scope.
 */
export const apiKeyOptionsResponseSchema = z.object({
  expiry: z.object({
    /**
     * The duration to preselect: `defaultExpiresIn`, or the longest preset
     * the cap allows when the configured default is over it. Absent when the
     * cap admits no preset at all.
     */
    default: apiKeyExpiresInSchema.optional(),
    /**
     * `maxExpiryDays`; 0 is unlimited.
     */
    maxDays: z.integer(),
    /**
     * The durations the server accepts, already filtered by the cap: render
     * these, never re-derive the policy.
     */
    presets: z.array(apiKeyExpiresInSchema),
  }),
  /**
   * The caller's ceiling: what its roles grant, narrowed by its own
   * permission scope, grouped like the rank catalogue.
   */
  permissions: permissionCatalogueSchema,
});

export type ApiKeyOptionsResponse = Infer<typeof apiKeyOptionsResponseSchema>;
