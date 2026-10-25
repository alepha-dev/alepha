import { type Infer, z } from "alepha";

/**
 * What `alepha capacitor release` publishes beside an encrypted bundle, and
 * what `POST /ota/bundles` and the admin's upload accept.
 *
 * It is authorized by the app-scoped publishing credential that uploads it,
 * not signed: Capgo v2 encryption protects the bundle's bytes, and nothing in
 * it vouches for this metadata. The server checks what it can check itself:
 * the ciphertext digest and size, and, with the app's public key, the
 * session key, the plugin checksum and the archive's own contents.
 *
 * Three digests, never confused:
 * - `archive.sha256`: the plain ZIP, what the plugin's checksum encrypts;
 * - `checksum`: the plugin's encrypted checksum, sent to devices as is;
 * - `ciphertext.sha256`: the encrypted file the server stores and serves.
 */
export const otaReleaseManifestSchema = z.object({
  /**
   * The manifest format, for the day it changes.
   */
  format: z.literal("alepha-ota/1"),

  /**
   * The release's own id, made by the publisher: a retried upload of the
   * same release is accepted once, a different one under the same id is
   * refused.
   */
  id: z.uuid(),

  /**
   * The native bundle identifier of the binary this release runs in, e.g.
   * `dev.alepha.mobile.acme` for a variant.
   */
  appId: z.text(),

  platform: z.enum(["ios", "android"]),

  /**
   * The variant built, `base` for an app without variants.
   */
  variant: z.text({ maxLength: 64 }),

  /**
   * The channel the release is published to.
   */
  channel: z.text({ maxLength: 64 }),

  /**
   * The bundle version devices report once they run it. Unique per app and
   * platform.
   */
  version: z.text({ maxLength: 128, pattern: /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/ }),

  /**
   * The exact native build numbers this bundle may run on, all built from
   * `fingerprint`. Never a range: a newer binary is added by a new release.
   */
  builds: z
    .array(z.text({ maxLength: 64 }))
    .min(1)
    .max(100),

  /**
   * The native fingerprint every build in `builds` shares.
   */
  fingerprint: z.text({ maxLength: 128 }),

  /**
   * The publisher key's identity, as the plugin computes it: the first 20
   * characters of the PKCS#1 public key's base64.
   */
  keyId: z.text({ maxLength: 64 }),

  archive: z.object({
    sha256: z.text({ maxLength: 64, pattern: /^[0-9a-f]{64}$/ }),
    size: z.integer(),
    expandedSize: z.integer(),
    files: z.integer(),
  }),

  /**
   * The plugin's encrypted checksum, hex.
   */
  checksum: z.text({ maxLength: 1024 }),

  /**
   * Capgo v2's `<iv>:<encrypted AES key>`, both base64.
   */
  sessionKey: z.text({ maxLength: 1024 }),

  ciphertext: z.object({
    sha256: z.text({ maxLength: 64, pattern: /^[0-9a-f]{64}$/ }),
    size: z.integer(),
  }),

  /**
   * The share of the channel's devices that get it, 0 to 100.
   */
  rollout: z.integer().min(0).max(100),

  createdAt: z.datetime(),
});

export type OtaReleaseManifest = Infer<typeof otaReleaseManifestSchema>;
