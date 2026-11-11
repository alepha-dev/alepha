import { z } from "alepha";
import { BadRequestError } from "alepha/server";

/**
 * A WebAuthn registration or assertion that failed verification, answered
 * 400.
 *
 * `reason` says which check refused it, for the server's own log. A
 * sign-in route never shows it to the caller: every refusal there reads the
 * same from outside, so nothing can be learned by trying.
 */
export const WebAuthnError = BadRequestError.extend({
  name: "WEBAUTHN",
  schema: z.object({
    reason: z.enum([
      "encoding",
      "cbor",
      "clientData",
      "type",
      "challenge",
      "origin",
      "crossOrigin",
      "rpId",
      "userPresent",
      "userVerified",
      "authenticatorData",
      "credential",
      "attestation",
      "algorithm",
      "signature",
      "counter",
    ]),
  }),
  message: "WebAuthn verification failed",
});

export type WebAuthnError = InstanceType<typeof WebAuthnError>;

/**
 * Bytes that are not the CBOR subset WebAuthn uses: an indefinite length, a
 * duplicate map key, a tag, a float, trailing bytes, or a truncated item.
 */
export const CborDecodeError = WebAuthnError.extend({
  name: "WEBAUTHN_CBOR",
  default: { reason: "cbor" },
  message: "Malformed CBOR",
});

export type CborDecodeError = InstanceType<typeof CborDecodeError>;

/**
 * A credential public key whose COSE algorithm, key type or curve is not
 * one the verifier accepts: ES256 (-7), RS256 (-257) and EdDSA (-8) on
 * Ed25519, the last one only where the runtime's WebCrypto has Ed25519.
 */
export const UnsupportedCoseAlgorithmError = WebAuthnError.extend({
  name: "WEBAUTHN_UNSUPPORTED_ALGORITHM",
  default: { reason: "algorithm" },
  message: "Unsupported credential algorithm",
});

export type UnsupportedCoseAlgorithmError = InstanceType<
  typeof UnsupportedCoseAlgorithmError
>;

/**
 * An assertion whose sign counter did not increase while the stored or the
 * received counter is non-zero: the mark of a cloned authenticator. Zero on
 * both sides is allowed, since most platform authenticators never count.
 */
export const PasskeyCounterRegressionError = WebAuthnError.extend({
  name: "PASSKEY_COUNTER_REGRESSION",
  default: { reason: "counter" },
  message: "Passkey sign counter did not increase",
});

export type PasskeyCounterRegressionError = InstanceType<
  typeof PasskeyCounterRegressionError
>;
