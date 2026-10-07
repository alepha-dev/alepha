import { type Infer, z } from "alepha";

/**
 * One native binary that `alepha capacitor build` produced, as recorded in
 * `capacitor.builds.json`.
 *
 * Keyed by `appId`, `platform` and `versionBuild` (the build number the
 * stores read). A key is written once: the same key with another
 * fingerprint is refused, because two different binaries announcing one
 * build number is exactly what a later compatibility check could not tell
 * apart. The `inputs` are kept so a refused fingerprint can say which input
 * moved.
 */
export const capacitorBuildRecordSchema = z.object({
  appId: z.string(),
  platform: z.enum(["ios", "android"]),

  /**
   * iOS `CURRENT_PROJECT_VERSION`, Android `versionCode`: opaque, compared
   * as a string.
   */
  versionBuild: z.string(),

  /**
   * The variant built, `base` for an app without variants.
   */
  variant: z.string(),

  configuration: z.enum(["debug", "release"]),

  /**
   * SHA-256 over the canonical, sorted `inputs`.
   */
  fingerprint: z.string(),

  /**
   * What the fingerprint was computed from: each native input file's
   * SHA-256, each native package's resolved version, the identity.
   */
  inputs: z.record(z.string(), z.string()),

  /**
   * Who signed it: `debug` for a development build, `team:<id>` for an iOS
   * release, `keystore:<alias>` for an Android release. Never a secret.
   */
  signing: z.string(),

  artifact: z.object({
    /**
     * Relative to the project root.
     */
    path: z.string(),
    sha256: z.string(),
  }),

  builtAt: z.string(),
});

/**
 * One successful native build, as `capacitor.builds.json` records it.
 */
export type CapacitorBuildRecord = Infer<typeof capacitorBuildRecordSchema>;
