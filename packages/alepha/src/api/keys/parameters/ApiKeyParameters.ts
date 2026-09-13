import { $atom, $store, type Infer, z } from "alepha";

import { apiKeyExpiresInSchema } from "../schemas/apiKeyExpiresInSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * API key module configuration atom.
 *
 * Server only, like every parameters atom: none of it reaches the browser. The
 * create dialog reads the part it needs (the default duration and the cap)
 * from `GET /api-keys/options` instead, so it never offers a duration the
 * server then refuses.
 */
export const apiKeyOptions = $atom({
  name: "alepha.api.keys.options",
  schema: z.object({
    /**
     * The duration a client preselects when it offers a choice, and the one
     * a rotation uses when it names none.
     */
    defaultExpiresIn: apiKeyExpiresInSchema.default("90d"),

    /**
     * The longest a key may live, in days. `0` means unlimited.
     *
     * Above `0` it caps every key, whichever way its expiry was asked for (a
     * preset or a raw `expiresAt`), and forbids `"never"` and an omitted
     * expiry. A request over the cap is refused with a message naming it,
     * never clamped.
     */
    maxExpiryDays: z
      .integer()
      .min(0)
      .describe("Longest lifetime of an API key in days. 0 is unlimited.")
      .default(0),

    /**
     * Days an expired key stays visible before the purge job deletes it,
     * measured from `expiresAt`. `0` disables this window.
     */
    purgeExpiredAfterDays: z
      .integer()
      .min(0)
      .describe("Days an expired key is kept. 0 keeps it forever.")
      .default(90),

    /**
     * Days a revoked key stays visible before the purge job deletes it,
     * measured from `revokedAt`. `0` disables this window.
     */
    purgeRevokedAfterDays: z
      .integer()
      .min(0)
      .describe("Days a revoked key is kept. 0 keeps it forever.")
      .default(90),

    /**
     * Days before `expiresAt` a key reads as `expiring`, and its owner is
     * told once. `0` disables both.
     */
    expiryWarningDays: z
      .integer()
      .min(0)
      .describe("Days before expiry a key is flagged. 0 disables the warning.")
      .default(7),

    /**
     * The shortest interval, in minutes, between two usage writes for one
     * key. `0` restores a write per authenticated request.
     */
    usageWriteIntervalMinutes: z
      .integer()
      .min(0)
      .describe("Minutes between usage writes per key. 0 writes every request.")
      .default(5),
  }),
  default: {
    defaultExpiresIn: "90d",
    maxExpiryDays: 0,
    purgeExpiredAfterDays: 90,
    purgeRevokedAfterDays: 90,
    expiryWarningDays: 7,
    usageWriteIntervalMinutes: 5,
  },
  serverOnly: true,
});

export type ApiKeyOptions = Infer<typeof apiKeyOptions.schema>;

declare module "alepha" {
  interface State {
    [apiKeyOptions.key]: ApiKeyOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Typed accessor for API key module configuration ({@link apiKeyOptions}).
 */
export class ApiKeyParameters {
  protected readonly options = $store(apiKeyOptions);

  public get<K extends keyof ApiKeyOptions>(key: K): ApiKeyOptions[K] {
    return this.options[key];
  }
}
