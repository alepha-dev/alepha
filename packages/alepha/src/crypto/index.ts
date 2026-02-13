import { $module } from "alepha";
import { CryptoProvider } from "./providers/CryptoProvider.ts";

export * from "./providers/CryptoProvider.ts";

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.1.0 | node, bun |
 *
 * Cryptographic utilities: hashing, HMAC, AES-256-GCM encryption, password hashing, and secure random generation.
 *
 * @module alepha.crypto
 */
export const AlephaCrypto = $module({
  name: "alepha.crypto",
  services: [CryptoProvider],
});
