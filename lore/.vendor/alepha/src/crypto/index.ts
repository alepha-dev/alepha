import { $module } from "alepha";

import { CryptoProvider } from "./providers/CryptoProvider.ts";
import { SecretProvider } from "./providers/SecretProvider.ts";

export * from "./providers/CryptoProvider.ts";
export * from "./providers/SecretProvider.ts";

/**
 * Cryptographic utilities: hashing, HMAC, AES-256-GCM encryption, password hashing, and secure random generation.
 *
 * @module alepha.crypto
 */
export const AlephaCrypto = $module({
  name: "alepha.crypto",
  services: [CryptoProvider],
  // A variant, not a service: created only when something injects it, so
  // only an app that signs something has to set `APP_SECRET`. The server
  // and etag modules reach this module for hashes and request ids alone,
  // and as a service its production guard refused to boot every app with a
  // server, whether it had a secret to protect or not. Every consumer
  // injects it from a class field, so its `configure` guard still runs
  // before the first read.
  variants: [SecretProvider],
});
