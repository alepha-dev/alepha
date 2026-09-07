import { appSecrets } from "../entities/appSecrets.ts";

/**
 * What a read path may say about a secret.
 *
 * ## ⚠️ Built with `pick`, so exclusion is the default
 *
 * The same rule as #1629's estate credential and the public roadmap's own
 * schema: a column added to `app_secrets` cannot ride along into a response by
 * being forgotten. Written as the row minus `valueSealed`, the next column
 * would default to visible and the mistake would be silent.
 *
 * **No read path returns a value, for anybody, the project owner included.** A
 * `type="password"` input is a rendering hint: it still sends the real value to
 * the client on every edit, so it is not the control. `valuePrefix` is what a
 * list answers instead, and it is empty for a value short enough that a prefix
 * would be most of it.
 */
export const appSecretResourceSchema = appSecrets.schema.pick({
  id: true,
  key: true,
  valuePrefix: true,
  updatedAt: true,
  updatedBy: true,
});
