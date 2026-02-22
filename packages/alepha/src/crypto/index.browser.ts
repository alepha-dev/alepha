import { $module } from "alepha";
import { BrowserCryptoProvider } from "./providers/BrowserCryptoProvider.ts";

export { BrowserCryptoProvider as CryptoProvider } from "./providers/BrowserCryptoProvider.ts";

/**
 * Cryptographic utilities: hashing, HMAC, AES-256-GCM encryption, password hashing, and secure random generation.
 *
 * @module alepha.crypto
 */
export const AlephaCrypto = $module({
  name: "alepha.crypto",
  services: [BrowserCryptoProvider],
});
