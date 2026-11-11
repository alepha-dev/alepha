import { $module } from "alepha";

import { CborEncoder } from "./CborEncoder.ts";
import { MemoryAuthenticator } from "./MemoryAuthenticator.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./CborEncoder.ts";
export * from "./MemoryAuthenticator.ts";
export * from "./MemoryPasskeyClient.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A software WebAuthn authenticator, for testing passkey flows with no
 * browser and no device.
 *
 * **Features:**
 * - Real registration and assertion responses on `crypto.subtle`: key
 *   pairs, COSE keys, authenticator data, signatures
 * - ES256, RS256 and EdDSA credentials, several per authenticator
 * - Knobs for a misbehaving device: origin, user verification, counter,
 *   cross-origin, and tampering with one field
 * - Runs on Node, Bun, workerd and jsdom
 * - `MemoryPasskeyClient`, the browser side: substitute it for
 *   `PasskeyClient` of `alepha/react/auth`
 *
 * @module alepha.testing.webauthn
 */
export const AlephaTestingWebAuthn = $module({
  name: "alepha.testing.webauthn",
  services: [CborEncoder, MemoryAuthenticator],
});
