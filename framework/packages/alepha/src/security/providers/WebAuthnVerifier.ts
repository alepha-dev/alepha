import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { RequestOriginPolicy } from "alepha/server";

import {
  PasskeyCounterRegressionError,
  WebAuthnError,
} from "../errors/WebAuthnError.ts";
import type { AuthenticationResponseJson } from "../schemas/authenticationResponseJsonSchema.ts";
import type { RegistrationResponseJson } from "../schemas/registrationResponseJsonSchema.ts";
import {
  type AuthenticatorDataFlags,
  AuthenticatorDataParser,
} from "./AuthenticatorDataParser.ts";
import { Base64Url } from "./Base64Url.ts";
import { CborDecoder, type CborValue } from "./CborDecoder.ts";
import { CoseKey, type WebAuthnPublicKeyJwk } from "./CoseKey.ts";

/**
 * Which origins a ceremony may come from.
 *
 * - `{ origins }`: the whole origin (`https://app.example.com`), compared
 *   exactly, one of a list.
 * - `{ host }`: the host (`app.example.com`, with its port when it has
 *   one), compared by host whatever the scheme. A proxy that ends TLS
 *   without forwarding the scheme makes the server see `http`, so the
 *   server cannot know its own origin, only its host.
 */
export type WebAuthnOriginRule = { origins: string[] } | { host: string };

/**
 * What every ceremony is checked against: the server's own challenge, the
 * relying party id, and where the browser may have run it.
 */
export interface WebAuthnExpectation {
  /**
   * The challenge the server issued, base64url.
   */
  challenge: string;
  /**
   * The relying party id: a hostname, no scheme and no port.
   */
  rpId: string;
  origin: WebAuthnOriginRule;
  /**
   * Refuse a ceremony in which the user was present but not verified.
   */
  requireUserVerification?: boolean;
}

/**
 * A registration that passed.
 */
export interface VerifiedRegistration {
  /**
   * The credential id, base64url.
   */
  credentialId: string;
  publicKey: WebAuthnPublicKeyJwk;
  /**
   * The COSE algorithm the credential signs with.
   */
  algorithm: number;
  signCount: number;
  aaguid: string;
  flags: AuthenticatorDataFlags;
  transports: string[];
  /**
   * The attestation statement format, for the log. Its statement is
   * trusted for nothing.
   */
  format: string;
}

/**
 * An assertion that passed.
 */
export interface VerifiedAssertion {
  credentialId: string;
  signCount: number;
  userVerified: boolean;
  backupEligible: boolean;
  backedUp: boolean;
  /**
   * The user handle the credential was registered with, base64url, when
   * the authenticator returned one.
   */
  userHandle?: string;
}

/**
 * Verifies WebAuthn registrations and assertions with `crypto.subtle` and
 * nothing else, so the same code runs on Node, Bun and workerd.
 *
 * It never reads a request: the caller passes the challenge it issued, the
 * RP id and the origin rule. Attestation is not trusted. Format `none` is
 * accepted, a `packed` self attestation has its signature checked, and any
 * other statement (a `packed` one with a certificate chain, `tpm`,
 * `android-key`, `apple`, `fido-u2f`) is accepted with the statement
 * ignored: nothing here checks a manufacturer chain, so refusing one would
 * lock an authenticator out for no protection.
 *
 * Every refusal is a {@link WebAuthnError} whose `reason` names the check.
 *
 * @example
 * ```ts
 * class Passkeys {
 *   verifier = $inject(WebAuthnVerifier);
 *
 *   async register(credential: RegistrationResponseJson, challenge: string) {
 *     const verified = await this.verifier.verifyRegistration(credential, {
 *       challenge,
 *       rpId: "example.com",
 *       origin: { host: "example.com" },
 *     });
 *     // store verified.credentialId, verified.publicKey, verified.signCount
 *   }
 * }
 * ```
 */
export class WebAuthnVerifier {
  protected readonly log = $logger();
  protected readonly base64url = $inject(Base64Url);
  protected readonly cbor = $inject(CborDecoder);
  protected readonly cose = $inject(CoseKey);
  protected readonly authenticatorData = $inject(AuthenticatorDataParser);
  protected readonly originPolicy = $inject(RequestOriginPolicy);

  /**
   * Verify the response of `navigator.credentials.create()`.
   */
  public async verifyRegistration(
    credential: RegistrationResponseJson,
    expected: WebAuthnExpectation,
  ): Promise<VerifiedRegistration> {
    const clientDataBytes = this.base64url.decode(
      credential.response.clientDataJSON,
    );
    this.checkClientData(clientDataBytes, "webauthn.create", expected);

    const attestation = this.cbor.decode(
      this.base64url.decode(credential.response.attestationObject),
    );
    if (!(attestation instanceof Map)) {
      throw new WebAuthnError({ reason: "attestation" });
    }
    const format = attestation.get("fmt");
    const statement = attestation.get("attStmt");
    const authDataBytes = attestation.get("authData");
    if (
      typeof format !== "string" ||
      !(statement instanceof Map) ||
      !(authDataBytes instanceof Uint8Array)
    ) {
      throw new WebAuthnError({ reason: "attestation" });
    }

    const authData = this.authenticatorData.parse(authDataBytes);
    await this.checkAuthenticatorData(authData, expected);
    const attested = authData.attestedCredential;
    if (!authData.flags.attestedCredentialData || !attested) {
      throw new WebAuthnError({ reason: "credential" });
    }
    const credentialId = this.base64url.encode(attested.credentialId);
    if (credential.id !== credentialId || credential.rawId !== credentialId) {
      throw new WebAuthnError({ reason: "credential" });
    }
    const publicKey = this.cose.toJwk(attested.publicKey);
    // Import now: a key the runtime cannot use is refused at enrolment,
    // never at the first sign-in.
    await this.cose.importKey(publicKey);

    await this.checkAttestation(
      format,
      statement,
      authDataBytes,
      clientDataBytes,
      publicKey,
    );

    return {
      credentialId,
      publicKey,
      algorithm: this.cose.algorithmOf(publicKey),
      signCount: authData.signCount,
      aaguid: attested.aaguid,
      flags: authData.flags,
      transports: credential.response.transports ?? [],
      format,
    };
  }

  /**
   * Verify the response of `navigator.credentials.get()` against the
   * credential's stored public key and counter.
   */
  public async verifyAssertion(
    credential: AuthenticationResponseJson,
    expected: WebAuthnExpectation & {
      publicKey: WebAuthnPublicKeyJwk;
      /**
       * The sign counter stored after the previous ceremony.
       */
      signCount: number;
    },
  ): Promise<VerifiedAssertion> {
    if (credential.id !== credential.rawId) {
      throw new WebAuthnError({ reason: "credential" });
    }
    const clientDataBytes = this.base64url.decode(
      credential.response.clientDataJSON,
    );
    this.checkClientData(clientDataBytes, "webauthn.get", expected);

    const authDataBytes = this.base64url.decode(
      credential.response.authenticatorData,
    );
    const authData = this.authenticatorData.parse(authDataBytes);
    await this.checkAuthenticatorData(authData, expected);

    const signature = this.base64url.decode(credential.response.signature);
    const signed = await this.signedBytes(authDataBytes, clientDataBytes);
    if (!(await this.cose.verify(expected.publicKey, signature, signed))) {
      throw new WebAuthnError({ reason: "signature" });
    }

    this.checkCounter(expected.signCount, authData.signCount);

    return {
      credentialId: credential.id,
      signCount: authData.signCount,
      userVerified: authData.flags.userVerified,
      backupEligible: authData.flags.backupEligible,
      backedUp: authData.flags.backedUp,
      userHandle: credential.response.userHandle || undefined,
    };
  }

  /**
   * The counter rule. A counter that did not increase, when either side is
   * non-zero, is a cloned authenticator or a replay; zero on both sides is
   * an authenticator that does not count.
   */
  public checkCounter(stored: number, received: number): void {
    if ((stored !== 0 || received !== 0) && received <= stored) {
      throw new PasskeyCounterRegressionError({ reason: "counter" });
    }
  }

  protected checkClientData(
    bytes: Uint8Array,
    type: "webauthn.create" | "webauthn.get",
    expected: WebAuthnExpectation,
  ): void {
    let clientData: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      if (typeof parsed !== "object" || parsed === null) {
        throw new WebAuthnError({ reason: "clientData" });
      }
      clientData = parsed as Record<string, unknown>;
    } catch {
      throw new WebAuthnError({ reason: "clientData" });
    }
    if (clientData.type !== type) {
      throw new WebAuthnError({ reason: "type" });
    }
    if (
      typeof clientData.challenge !== "string" ||
      !this.constantTimeEqual(clientData.challenge, expected.challenge)
    ) {
      throw new WebAuthnError({ reason: "challenge" });
    }
    if (
      typeof clientData.origin !== "string" ||
      !this.originMatches(clientData.origin, expected.origin)
    ) {
      throw new WebAuthnError({ reason: "origin" });
    }
    // A ceremony run in a cross-origin iframe: no relying party here
    // embeds itself in another site's page.
    if (clientData.crossOrigin === true) {
      throw new WebAuthnError({ reason: "crossOrigin" });
    }
  }

  protected originMatches(origin: string, rule: WebAuthnOriginRule): boolean {
    if ("origins" in rule) {
      return rule.origins.some(
        (it) => it.replace(/\/+$/, "").toLowerCase() === origin.toLowerCase(),
      );
    }
    return this.originPolicy.isSameHost(origin, rule.host);
  }

  protected async checkAuthenticatorData(
    authData: { rpIdHash: Uint8Array; flags: AuthenticatorDataFlags },
    expected: WebAuthnExpectation,
  ): Promise<void> {
    const rpIdHash = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(expected.rpId),
      ),
    );
    if (!this.bytesEqual(rpIdHash, authData.rpIdHash)) {
      throw new WebAuthnError({ reason: "rpId" });
    }
    if (!authData.flags.userPresent) {
      throw new WebAuthnError({ reason: "userPresent" });
    }
    if (expected.requireUserVerification && !authData.flags.userVerified) {
      throw new WebAuthnError({ reason: "userVerified" });
    }
  }

  protected async checkAttestation(
    format: string,
    statement: Map<number | string, CborValue>,
    authData: Uint8Array,
    clientData: Uint8Array,
    publicKey: WebAuthnPublicKeyJwk,
  ): Promise<void> {
    if (format === "none") {
      return;
    }
    if (format === "packed" && !statement.has("x5c")) {
      // Self attestation: signed by the credential key itself, over the
      // same bytes an assertion signs.
      const alg = statement.get("alg");
      const sig = statement.get("sig");
      if (alg !== this.cose.algorithmOf(publicKey)) {
        throw new WebAuthnError({ reason: "attestation" });
      }
      if (!(sig instanceof Uint8Array)) {
        throw new WebAuthnError({ reason: "attestation" });
      }
      const signed = await this.signedBytes(authData, clientData);
      if (!(await this.cose.verify(publicKey, sig, signed))) {
        throw new WebAuthnError({ reason: "attestation" });
      }
      return;
    }
    this.log.debug("Attestation statement ignored", {
      format,
      certificateChain: statement.has("x5c"),
    });
  }

  protected async signedBytes(
    authData: Uint8Array,
    clientData: Uint8Array,
  ): Promise<Uint8Array> {
    const hash = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        clientData as Uint8Array<ArrayBuffer>,
      ),
    );
    const out = new Uint8Array(authData.length + hash.length);
    out.set(authData, 0);
    out.set(hash, authData.length);
    return out;
  }

  protected bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a[i]! ^ b[i]!;
    }
    return diff === 0;
  }

  protected constantTimeEqual(a: string, b: string): boolean {
    const encoder = new TextEncoder();
    return this.bytesEqual(encoder.encode(a), encoder.encode(b));
  }
}
