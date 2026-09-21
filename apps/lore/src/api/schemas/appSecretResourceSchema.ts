import { z } from "alepha";

import { appSecrets } from "../entities/appSecrets.ts";

/**
 * What a read path may say about a stored variable.
 *
 * ## ⚠️ Built with `pick`, so exclusion is the default
 *
 * The same rule as #1629's estate credential and the public roadmap's own
 * schema: a column added to `app_secrets` cannot ride along into a response by
 * being forgotten. Written as the row minus `valueSealed`, the next column
 * would default to visible and the mistake would be silent.
 *
 * **No read path returns a SECRET's value, for anybody, the project owner
 * included.** `valuePrefix` is what a list answers instead, and it is empty for
 * a value short enough that a prefix would be most of it.
 *
 * A VARIABLE's value is returned (#Q2467): the app declared it `secret: false`,
 * it ships as a plain binding, and `value` is only ever stored for one. The
 * column is absent on a secret's row by construction, so picking it cannot
 * leak one.
 */
export const appSecretResourceSchema = appSecrets.schema
  .pick({
    id: true,
    key: true,
    value: true,
    valuePrefix: true,
    updatedAt: true,
    updatedBy: true,
  })
  .extend({
    /**
     * `variable` when the stored row carries a readable value, `secret`
     * otherwise.
     */
    kind: z.enum(["secret", "variable"]),
  });
