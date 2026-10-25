import { $module } from "alepha";

export * from "./providers/CryptoProviderBase.ts";

import { BrowserCryptoProvider } from "./providers/BrowserCryptoProvider.ts";

export { BrowserCryptoProvider as CryptoProvider } from "./providers/BrowserCryptoProvider.ts";

/**
 * Cryptographic utilities: hashing, HMAC, AES-256-GCM encryption, and secure
 * random generation. Password hashing is server-only — the browser provider
 * throws for `hashPassword` / `verifyPassword`.
 *
 * @module alepha.crypto
 */
export const AlephaCrypto = $module({
  name: "alepha.crypto",
  services: [BrowserCryptoProvider],
});
