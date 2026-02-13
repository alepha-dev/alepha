import { $module } from "alepha";
import { BrowserCryptoProvider } from "./providers/BrowserCryptoProvider.ts";

export { BrowserCryptoProvider as CryptoProvider } from "./providers/BrowserCryptoProvider.ts";

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.1.0 | browser, workerd |
 *
 * Cryptographic utilities: hashing, HMAC, AES-256-GCM encryption, password hashing, and secure random generation.
 *
 * @module alepha.crypto
 */
export const AlephaCrypto = $module({
  name: "alepha.crypto",
  services: [BrowserCryptoProvider],
});
