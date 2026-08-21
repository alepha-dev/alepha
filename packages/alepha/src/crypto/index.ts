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
  services: [CryptoProvider, SecretProvider],
});
