import type { Alepha } from "alepha";

import { AuthenticatorDataParser } from "../../providers/AuthenticatorDataParser.ts";
import { Base64Url } from "../../providers/Base64Url.ts";
import { CborDecoder } from "../../providers/CborDecoder.ts";
import { CoseKey } from "../../providers/CoseKey.ts";
import {
  type WebAuthnExpectation,
  WebAuthnVerifier,
} from "../../providers/WebAuthnVerifier.ts";
import type { AuthenticationResponseJson } from "../../schemas/authenticationResponseJsonSchema.ts";
import type { RegistrationResponseJson } from "../../schemas/registrationResponseJsonSchema.ts";
import { chromiumWebAuthnCapture } from "./chromiumCapture.ts";
import { type W3cWebAuthnVector, w3cWebAuthnVectors } from "./w3cVectors.ts";

/**
 * What a case ends in: a JSON summary of what passed, or the refusal's
 * error name and reason. JSON on purpose, so a worker can send it back.
 */
export type WebAuthnCaseOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: string; reason?: string };

/**
 * One case: what it runs, and the outcome it must end in.
 */
export interface WebAuthnCase {
  name: string;
  expected: WebAuthnCaseOutcome;
  run: (alepha: Alepha) => Promise<unknown>;
}

/**
 * The WebAuthn verifier's cases, written once and run by three spec files:
 * Vitest on Node, `bun test`, and a worker in Miniflare. There is no way to
 * run one spec file under three runtimes, so the table is the shared part
 * and each spec only compares outcomes.
 *
 * Cases may be added by other modules' tables (the software authenticator
 * of `alepha/testing/webauthn` adds generated ones) through `extra`.
 */
export class WebAuthnCaseTable {
  public readonly cases: WebAuthnCase[] = [];

  constructor(extra: WebAuthnCase[] = []) {
    this.addCborCases();
    this.addCoseCases();
    this.addAuthenticatorDataCases();
    this.addW3cCases();
    this.addTamperedVectorCases();
    this.addChromiumCases();
    this.cases.push(...extra);
  }

  /**
   * Run every case and report its outcome, by name.
   */
  public async runAll(
    alepha: Alepha,
  ): Promise<Array<{ name: string; outcome: WebAuthnCaseOutcome }>> {
    const out: Array<{ name: string; outcome: WebAuthnCaseOutcome }> = [];
    for (const it of this.cases) {
      out.push({ name: it.name, outcome: await this.runOne(alepha, it) });
    }
    return out;
  }

  public async runOne(
    alepha: Alepha,
    it: WebAuthnCase,
  ): Promise<WebAuthnCaseOutcome> {
    try {
      const value = await it.run(alepha);
      return { ok: true, value: JSON.parse(JSON.stringify(value ?? null)) };
    } catch (error) {
      const e = error as { name?: string; data?: { reason?: string } };
      return {
        ok: false,
        error: String(e.name),
        ...(e.data?.reason ? { reason: e.data.reason } : {}),
      };
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  public hex(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  public b64u(alepha: Alepha, hex: string): string {
    return alepha.inject(Base64Url).encode(this.hex(hex));
  }

  public w3cExpectation(
    alepha: Alepha,
    challengeHex: string,
  ): WebAuthnExpectation {
    return {
      challenge: this.b64u(alepha, challengeHex),
      rpId: "example.org",
      origin: { origins: ["https://example.org"] },
    };
  }

  public w3cRegistration(
    alepha: Alepha,
    vector: W3cWebAuthnVector,
    attestationObject = vector.registration.attestationObject,
  ): RegistrationResponseJson {
    const id = this.b64u(alepha, vector.registration.credentialId);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: this.b64u(alepha, vector.registration.clientDataJSON),
        attestationObject: this.b64u(alepha, attestationObject),
      },
    };
  }

  public w3cAssertion(
    alepha: Alepha,
    vector: W3cWebAuthnVector,
    overrides: { signature?: string; clientDataJSON?: string } = {},
  ): AuthenticationResponseJson {
    const id = this.b64u(alepha, vector.registration.credentialId);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: this.b64u(
          alepha,
          overrides.clientDataJSON ?? vector.authentication.clientDataJSON,
        ),
        authenticatorData: this.b64u(
          alepha,
          vector.authentication.authenticatorData,
        ),
        signature: this.b64u(
          alepha,
          overrides.signature ?? vector.authentication.signature,
        ),
      },
    };
  }

  public vector(name: string): W3cWebAuthnVector {
    const found = w3cWebAuthnVectors.find((it) => it.name === name);
    if (!found) {
      throw new TypeError(`No W3C vector ${name}`);
    }
    return found;
  }

  /**
   * Register then assert one W3C vector, summarised.
   */
  public async w3cCeremony(
    alepha: Alepha,
    vector: W3cWebAuthnVector,
    assertion: Partial<WebAuthnExpectation> & { signCount?: number } = {},
  ) {
    const verifier = alepha.inject(WebAuthnVerifier);
    const registered = await verifier.verifyRegistration(
      this.w3cRegistration(alepha, vector),
      this.w3cExpectation(alepha, vector.registration.challenge),
    );
    const asserted = await verifier.verifyAssertion(
      this.w3cAssertion(alepha, vector),
      {
        ...this.w3cExpectation(alepha, vector.authentication.challenge),
        publicKey: registered.publicKey,
        signCount: 0,
        ...assertion,
      },
    );
    return {
      format: registered.format,
      algorithm: registered.algorithm,
      aaguid: registered.aaguid,
      registeredCount: registered.signCount,
      assertedCount: asserted.signCount,
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected refused(error: string, reason?: string): WebAuthnCaseOutcome {
    return { ok: false, error, ...(reason ? { reason } : {}) };
  }

  protected addCborCases(): void {
    const decode = (hex: string) => (alepha: Alepha) => {
      const value = alepha.inject(CborDecoder).decode(this.hex(hex));
      return Promise.resolve(
        value instanceof Map ? Object.fromEntries(value) : value,
      );
    };
    const cbor = this.refused("WEBAUTHN_CBOR", "cbor");
    this.cases.push(
      {
        name: "cbor: decodes a map of integers, negative integers, text and simple values",
        // {1: 2, -1: "a", "k": [true, false, null]}
        expected: {
          ok: true,
          value: { 1: 2, "-1": "a", k: [true, false, null] },
        },
        run: decode("a30102206161616b83f5f4f6"),
      },
      {
        name: "cbor: decodes a 64-bit unsigned integer",
        expected: { ok: true, value: 4294967296 },
        run: decode("1b0000000100000000"),
      },
      {
        name: "cbor: refuses an indefinite-length array",
        expected: cbor,
        run: decode("9f01ff"),
      },
      {
        name: "cbor: refuses an indefinite-length byte string",
        expected: cbor,
        run: decode("5f4101ff"),
      },
      {
        name: "cbor: refuses a duplicate map key",
        expected: cbor,
        run: decode("a201010102"),
      },
      {
        name: "cbor: refuses trailing bytes",
        expected: cbor,
        run: decode("0100"),
      },
      {
        name: "cbor: refuses a truncated byte string",
        expected: cbor,
        run: decode("4301"),
      },
      { name: "cbor: refuses a tag", expected: cbor, run: decode("c001") },
      { name: "cbor: refuses a float", expected: cbor, run: decode("f93c00") },
      {
        name: "cbor: refuses a map keyed by a byte string",
        expected: cbor,
        run: decode("a1410101"),
      },
      {
        name: "cbor: refuses an integer past MAX_SAFE_INTEGER",
        expected: cbor,
        run: decode("1bffffffffffffffff"),
      },
    );
  }

  protected addCoseCases(): void {
    const toJwk = (entries: Array<[number, unknown]>) => (alepha: Alepha) =>
      Promise.resolve(
        alepha.inject(CoseKey).toJwk(new Map(entries as any) as any),
      );
    const x = new Uint8Array(32).fill(1);
    this.cases.push(
      {
        name: "cose: an ES384 key is an unsupported algorithm",
        expected: this.refused("WEBAUTHN_UNSUPPORTED_ALGORITHM", "algorithm"),
        run: toJwk([
          [1, 2],
          [3, -35],
          [-1, 2],
          [-2, new Uint8Array(48)],
          [-3, new Uint8Array(48)],
        ]),
      },
      {
        name: "cose: an ES256 key on a curve other than P-256 is refused",
        expected: this.refused("WEBAUTHN_UNSUPPORTED_ALGORITHM", "algorithm"),
        run: toJwk([
          [1, 2],
          [3, -7],
          [-1, 8],
          [-2, x],
          [-3, x],
        ]),
      },
      {
        name: "cose: an ES256 key with a short coordinate is refused",
        expected: this.refused("WEBAUTHN", "credential"),
        run: toJwk([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, new Uint8Array(31)],
          [-3, x],
        ]),
      },
      {
        name: "cose: an OKP key on Ed25519 becomes an EdDSA JWK",
        expected: {
          ok: true,
          value: {
            kty: "OKP",
            alg: "EdDSA",
            crv: "Ed25519",
            x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
          },
        },
        run: toJwk([
          [1, 1],
          [3, -8],
          [-1, 6],
          [-2, x],
        ]),
      },
      {
        name: "cose: a DER signature that is not a SEQUENCE is refused",
        expected: this.refused("WEBAUTHN", "signature"),
        run: (alepha) =>
          Promise.resolve(
            alepha.inject(CoseKey).derToRaw(this.hex("3102010102010100"), 32),
          ),
      },
      {
        name: "cose: a DER integer with a needless leading zero is refused",
        expected: this.refused("WEBAUTHN", "signature"),
        run: (alepha) =>
          Promise.resolve(
            alepha.inject(CoseKey).derToRaw(this.hex("300702020001020101"), 32),
          ),
      },
      {
        name: "cose: a DER signature with trailing bytes is refused",
        expected: this.refused("WEBAUTHN", "signature"),
        run: (alepha) =>
          Promise.resolve(
            alepha.inject(CoseKey).derToRaw(this.hex("3006020101020101ff"), 32),
          ),
      },
    );
  }

  protected addAuthenticatorDataCases(): void {
    const none = () => this.vector("none.ES256");
    this.cases.push(
      {
        name: "authenticator data: truncated before the counter is refused",
        expected: this.refused("WEBAUTHN", "authenticatorData"),
        run: (alepha) =>
          Promise.resolve(
            alepha
              .inject(AuthenticatorDataParser)
              .parse(
                this.hex(none().authentication.authenticatorData.slice(0, 70)),
              ),
          ),
      },
      {
        name: "authenticator data: trailing bytes are refused",
        expected: this.refused("WEBAUTHN", "authenticatorData"),
        run: (alepha) =>
          Promise.resolve(
            alepha
              .inject(AuthenticatorDataParser)
              .parse(this.hex(`${none().authentication.authenticatorData}00`)),
          ),
      },
      {
        name: "authenticator data: rpIdHash, flags and counter are read",
        expected: {
          ok: true,
          value: {
            signCount: 0,
            userPresent: true,
            backupEligible: true,
            backedUp: true,
          },
        },
        run: (alepha) => {
          const parsed = alepha
            .inject(AuthenticatorDataParser)
            .parse(this.hex(none().authentication.authenticatorData));
          return Promise.resolve({
            signCount: parsed.signCount,
            userPresent: parsed.flags.userPresent,
            backupEligible: parsed.flags.backupEligible,
            backedUp: parsed.flags.backedUp,
          });
        },
      },
    );
  }

  protected addW3cCases(): void {
    const passes = [
      ["none.ES256", "none", -7],
      ["packed-self.ES256", "packed", -7],
      ["longCredentialId.ES256", "none", -7],
      ["packed.ES256", "packed", -7],
      ["packed.RS256", "packed", -257],
      ["packed.Ed25519", "packed", -8],
      ["tpm.ES256", "tpm", -7],
      ["android-key.ES256", "android-key", -7],
      ["apple.ES256", "apple", -7],
      ["fido-u2f.ES256", "fido-u2f", -7],
    ] as const;
    for (const [name, format, algorithm] of passes) {
      const vector = this.vector(name);
      this.cases.push({
        name: `w3c ${vector.section}: registers and asserts`,
        expected: {
          ok: true,
          value: {
            format,
            algorithm,
            aaguid: this.uuid(vector.registration.aaguid),
            registeredCount: 0,
            assertedCount: 0,
          },
        },
        run: (alepha) => this.w3cCeremony(alepha, vector),
      });
    }
    for (const name of ["packed.ES384", "packed.ES512", "packed.Ed448"]) {
      const vector = this.vector(name);
      this.cases.push({
        name: `w3c ${vector.section}: is an unsupported algorithm`,
        expected: this.refused("WEBAUTHN_UNSUPPORTED_ALGORITHM", "algorithm"),
        run: (alepha) => this.w3cCeremony(alepha, vector),
      });
    }
    for (const name of ["crossOrigin.ES256", "topOrigin.ES256"]) {
      const vector = this.vector(name);
      this.cases.push({
        name: `w3c ${vector.section}: a cross-origin ceremony is refused`,
        expected: this.refused("WEBAUTHN", "crossOrigin"),
        run: (alepha) => this.w3cCeremony(alepha, vector),
      });
    }
  }

  protected addTamperedVectorCases(): void {
    const none = this.vector("none.ES256");
    const self = this.vector("packed-self.ES256");
    const register = (
      alepha: Alepha,
      vector: W3cWebAuthnVector,
      expectation: Partial<WebAuthnExpectation> = {},
      attestationObject?: string,
    ) =>
      alepha
        .inject(WebAuthnVerifier)
        .verifyRegistration(
          this.w3cRegistration(alepha, vector, attestationObject),
          {
            ...this.w3cExpectation(alepha, vector.registration.challenge),
            ...expectation,
          },
        );
    this.cases.push(
      {
        name: "registration: another challenge is refused",
        expected: this.refused("WEBAUTHN", "challenge"),
        run: (alepha) =>
          register(alepha, none, {
            challenge: this.b64u(alepha, none.authentication.challenge),
          }),
      },
      {
        name: "registration: an origin outside the list is refused",
        expected: this.refused("WEBAUTHN", "origin"),
        run: (alepha) =>
          register(alepha, none, {
            origin: { origins: ["https://example.com"] },
          }),
      },
      {
        name: "registration: the origin is compared by host when the rule is a host",
        expected: { ok: true, value: "none" },
        run: async (alepha) =>
          (await register(alepha, none, { origin: { host: "example.org" } }))
            .format,
      },
      {
        name: "registration: another host is refused",
        expected: this.refused("WEBAUTHN", "origin"),
        run: (alepha) =>
          register(alepha, none, { origin: { host: "example.org:8443" } }),
      },
      {
        name: "registration: another RP id is refused",
        expected: this.refused("WEBAUTHN", "rpId"),
        run: (alepha) => register(alepha, none, { rpId: "example.com" }),
      },
      {
        name: "registration: an assertion's client data is not a registration",
        expected: this.refused("WEBAUTHN", "type"),
        run: (alepha) =>
          alepha.inject(WebAuthnVerifier).verifyRegistration(
            {
              ...this.w3cRegistration(alepha, none),
              response: {
                clientDataJSON: this.b64u(
                  alepha,
                  none.authentication.clientDataJSON,
                ),
                attestationObject: this.b64u(
                  alepha,
                  none.registration.attestationObject,
                ),
              },
            },
            this.w3cExpectation(alepha, none.authentication.challenge),
          ),
      },
      {
        name: "registration: an id that is not the attested credential id is refused",
        expected: this.refused("WEBAUTHN", "credential"),
        run: (alepha) =>
          alepha.inject(WebAuthnVerifier).verifyRegistration(
            {
              ...this.w3cRegistration(alepha, none),
              id: "AAAA",
              rawId: "AAAA",
            },
            this.w3cExpectation(alepha, none.registration.challenge),
          ),
      },
      {
        name: "registration: a packed self attestation with a bad signature is refused",
        expected: this.refused("WEBAUTHN", "attestation"),
        run: (alepha) => {
          // The signature's DER starts after `sig` and its byte-string
          // header; flip a bit well inside `r`.
          const object = self.registration.attestationObject;
          const at = object.indexOf("63736967") + 8 + 4 + 20;
          const flipped = (Number.parseInt(object.slice(at, at + 2), 16) ^ 1)
            .toString(16)
            .padStart(2, "0");
          return register(
            alepha,
            self,
            {},
            object.slice(0, at) + flipped + object.slice(at + 2),
          );
        },
      },
      {
        name: "assertion: another challenge is refused",
        expected: this.refused("WEBAUTHN", "challenge"),
        run: (alepha) =>
          this.w3cCeremony(alepha, none, {
            challenge: this.b64u(alepha, none.registration.challenge),
          }),
      },
      {
        name: "assertion: another origin is refused",
        expected: this.refused("WEBAUTHN", "origin"),
        run: (alepha) =>
          this.w3cCeremony(alepha, none, { origin: { host: "example.com" } }),
      },
      {
        name: "assertion: another RP id is refused",
        expected: this.refused("WEBAUTHN", "rpId"),
        run: (alepha) =>
          this.w3cCeremony(alepha, none, { rpId: "example.com" }),
      },
      {
        name: "assertion: user verification is refused when required and absent",
        expected: this.refused("WEBAUTHN", "userVerified"),
        // none.ES256 asserts with flags 0x19: present, not verified.
        run: (alepha) =>
          this.w3cCeremony(alepha, none, { requireUserVerification: true }),
      },
      {
        name: "assertion: a registration's client data is not an assertion",
        expected: this.refused("WEBAUTHN", "type"),
        run: async (alepha) => {
          const verifier = alepha.inject(WebAuthnVerifier);
          const registered = await register(alepha, none);
          return verifier.verifyAssertion(
            this.w3cAssertion(alepha, none, {
              clientDataJSON: none.registration.clientDataJSON,
            }),
            {
              ...this.w3cExpectation(alepha, none.registration.challenge),
              publicKey: registered.publicKey,
              signCount: 0,
            },
          );
        },
      },
      {
        name: "assertion: a signature of other bytes is refused",
        expected: this.refused("WEBAUTHN", "signature"),
        run: async (alepha) => {
          const verifier = alepha.inject(WebAuthnVerifier);
          const registered = await register(alepha, none);
          // The packed-self vector's assertion signature: valid DER, wrong key and data.
          return verifier.verifyAssertion(
            this.w3cAssertion(alepha, none, {
              signature: self.authentication.signature,
            }),
            {
              ...this.w3cExpectation(alepha, none.authentication.challenge),
              publicKey: registered.publicKey,
              signCount: 0,
            },
          );
        },
      },
      {
        name: "assertion: a malformed DER signature is refused",
        expected: this.refused("WEBAUTHN", "signature"),
        run: async (alepha) => {
          const verifier = alepha.inject(WebAuthnVerifier);
          const registered = await register(alepha, none);
          return verifier.verifyAssertion(
            this.w3cAssertion(alepha, none, {
              signature: `31${none.authentication.signature.slice(2)}`,
            }),
            {
              ...this.w3cExpectation(alepha, none.authentication.challenge),
              publicKey: registered.publicKey,
              signCount: 0,
            },
          );
        },
      },
      {
        name: "assertion: a counter of zero after a non-zero one is a regression",
        expected: this.refused("PASSKEY_COUNTER_REGRESSION", "counter"),
        run: (alepha) => this.w3cCeremony(alepha, none, { signCount: 5 }),
      },
      {
        name: "counter: zero on both sides is accepted, a rise is accepted",
        expected: { ok: true, value: "ok" },
        run: (alepha) => {
          const verifier = alepha.inject(WebAuthnVerifier);
          verifier.checkCounter(0, 0);
          verifier.checkCounter(0, 3);
          verifier.checkCounter(3, 4);
          return Promise.resolve("ok");
        },
      },
      {
        name: "counter: an equal non-zero counter is a regression",
        expected: this.refused("PASSKEY_COUNTER_REGRESSION", "counter"),
        run: (alepha) => {
          alepha.inject(WebAuthnVerifier).checkCounter(4, 4);
          return Promise.resolve();
        },
      },
    );
  }

  protected addChromiumCases(): void {
    const capture = chromiumWebAuthnCapture;
    const ceremony = async (alepha: Alepha, storedCount?: number) => {
      const verifier = alepha.inject(WebAuthnVerifier);
      const origin = { origins: [capture.origin] };
      const registered = await verifier.verifyRegistration(
        capture.registration.credential as RegistrationResponseJson,
        {
          challenge: capture.registration.challenge,
          rpId: capture.rpId,
          origin,
        },
      );
      const asserted = await verifier.verifyAssertion(
        capture.authentication.credential as AuthenticationResponseJson,
        {
          challenge: capture.authentication.challenge,
          rpId: capture.rpId,
          origin,
          requireUserVerification: true,
          publicKey: registered.publicKey,
          signCount: storedCount ?? registered.signCount,
        },
      );
      return {
        format: registered.format,
        algorithm: registered.algorithm,
        transports: registered.transports,
        registeredCount: registered.signCount,
        assertedCount: asserted.signCount,
        userVerified: asserted.userVerified,
        userHandle: asserted.userHandle,
      };
    };
    this.cases.push(
      {
        name: "chromium: a virtual authenticator's registration and assertion pass",
        expected: {
          ok: true,
          value: {
            format: "none",
            algorithm: -7,
            transports: ["internal"],
            registeredCount: 1,
            assertedCount: 2,
            userVerified: true,
            userHandle: "AQIDBA",
          },
        },
        run: (alepha) => ceremony(alepha),
      },
      {
        name: "chromium: replaying the assertion after its counter is stored is a regression",
        expected: this.refused("PASSKEY_COUNTER_REGRESSION", "counter"),
        run: (alepha) => ceremony(alepha, 2),
      },
    );
  }

  protected uuid(hex: string): string {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
