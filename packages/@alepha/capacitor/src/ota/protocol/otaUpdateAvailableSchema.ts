import { type Infer, z } from "alepha";

/**
 * An update check's answer when the device should run another bundle: what
 * the pinned updater's `download()` needs, as it reads it.
 *
 * - `url` is a short-lived download link (`/ota/bundles/:id/download?token=`);
 * - `session_key` is Capgo v2's `<iv>:<encrypted AES key>`, both base64,
 *   the key encrypted with the publisher's private key;
 * - `checksum` is the plugin's encrypted checksum: the SHA-256 of the plain
 *   ZIP, encrypted with the publisher's private key, hex. It is not the
 *   ciphertext digest the server stores and verifies on its own.
 *
 * The same answer serves a newer bundle, a rollback to an older one and a
 * channel's fallback: the device runs what it is told, whatever the version
 * order.
 */
export const otaUpdateAvailableSchema = z.object({
  version: z.text({ maxLength: 128 }),
  url: z.text({ maxLength: 2048 }),
  session_key: z.text({ maxLength: 1024 }),
  checksum: z.text({ maxLength: 1024 }),
});

export type OtaUpdateAvailable = Infer<typeof otaUpdateAvailableSchema>;
