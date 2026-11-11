import type { Alepha } from "alepha";
import {
  type AuthenticationOptionsJson,
  type AuthenticationResponseJson,
  type RegistrationOptionsJson,
  type RegistrationResponseJson,
  type WebAuthnExpectation,
  WebAuthnVerifier,
} from "alepha/security";

import type {
  WebAuthnCase,
  WebAuthnCaseOutcome,
} from "../../../security/__tests__/webauthn/WebAuthnCaseTable.ts";
import {
  MemoryAuthenticator,
  type MemoryAssertionOptions,
  type MemoryAuthenticatorAlgorithm,
  type MemoryRegistrationOptions,
} from "../MemoryAuthenticator.ts";

/**
 * Generated cases for the verifier's case table: a {@link MemoryAuthenticator}
 * answers fresh options, with a knob turned for each refusal. Every reason a
 * `WebAuthnError` can carry has at least one case here, so a refusal is
 * proven against a response the verifier would otherwise accept.
 */
export class MemoryAuthenticatorCases {
  public readonly origin = "https://app.example.test";
  public readonly rpId = "app.example.test";

  public readonly cases: WebAuthnCase[] = [];

  constructor() {
    this.addPassingCases();
    this.addRefusals();
  }

  public registrationOptions(challenge: string): RegistrationOptionsJson {
    return {
      rp: { id: this.rpId, name: "Example" },
      user: { id: "dXNlci0x", name: "ada@example.test", displayName: "Ada" },
      challenge,
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
        { type: "public-key", alg: -8 },
      ],
      attestation: "none",
    };
  }

  public expectation(
    challenge: string,
    overrides: Partial<WebAuthnExpectation> = {},
  ): WebAuthnExpectation {
    return {
      challenge,
      rpId: this.rpId,
      origin: { origins: [this.origin] },
      ...overrides,
    };
  }

  /**
   * Register with the authenticator, then assert, and summarise.
   */
  public async ceremony(
    alepha: Alepha,
    knobs: {
      register?: MemoryRegistrationOptions;
      assert?: MemoryAssertionOptions;
      registration?: Partial<WebAuthnExpectation>;
      assertion?: Partial<WebAuthnExpectation> & { signCount?: number };
      mutateRegistration?: (
        r: RegistrationResponseJson,
      ) => RegistrationResponseJson;
      mutateAssertion?: (
        a: AuthenticationResponseJson,
      ) => AuthenticationResponseJson;
      allow?: boolean;
    } = {},
  ) {
    const device = alepha.inject(MemoryAuthenticator);
    device.origin = this.origin;
    const verifier = alepha.inject(WebAuthnVerifier);

    const created = await device.create(
      this.registrationOptions("cmVnaXN0cmF0aW9u"),
      knobs.register,
    );
    const registered = await verifier.verifyRegistration(
      knobs.mutateRegistration?.(created) ?? created,
      this.expectation("cmVnaXN0cmF0aW9u", knobs.registration),
    );
    const request: AuthenticationOptionsJson = {
      challenge: "YXNzZXJ0aW9u",
      rpId: this.rpId,
      allowCredentials: knobs.allow
        ? [{ type: "public-key", id: registered.credentialId }]
        : [],
    };
    const got = await device.get(request, knobs.assert);
    const asserted = await verifier.verifyAssertion(
      knobs.mutateAssertion?.(got) ?? got,
      {
        ...this.expectation("YXNzZXJ0aW9u"),
        publicKey: registered.publicKey,
        signCount: registered.signCount,
        ...knobs.assertion,
      },
    );
    return {
      format: registered.format,
      algorithm: registered.algorithm,
      registeredCount: registered.signCount,
      assertedCount: asserted.signCount,
      userVerified: asserted.userVerified,
      backedUp: asserted.backedUp,
      userHandle: asserted.userHandle,
    };
  }

  protected refused(error: string, reason: string): WebAuthnCaseOutcome {
    return { ok: false, error, reason };
  }

  protected addPassingCases(): void {
    const algorithms: Array<[MemoryAuthenticatorAlgorithm, number]> = [
      ["ES256", -7],
      ["RS256", -257],
      ["EdDSA", -8],
    ];
    for (const [algorithm, cose] of algorithms) {
      for (const attestation of ["none", "packed"] as const) {
        this.cases.push({
          name: `memory authenticator: ${algorithm} with ${attestation} attestation registers and asserts`,
          expected: {
            ok: true,
            value: {
              format: attestation,
              algorithm: cose,
              registeredCount: 0,
              assertedCount: 1,
              userVerified: true,
              backedUp: true,
              userHandle: "dXNlci0x",
            },
          },
          run: (alepha) =>
            this.ceremony(alepha, {
              register: { algorithm, attestation },
              allow: true,
            }),
        });
      }
    }
    this.cases.push(
      {
        name: "memory authenticator: a device-bound credential without user verification passes when UV is not required",
        expected: {
          ok: true,
          value: {
            format: "none",
            algorithm: -7,
            registeredCount: 0,
            assertedCount: 1,
            userVerified: false,
            backedUp: false,
            userHandle: "dXNlci0x",
          },
        },
        run: (alepha) =>
          this.ceremony(alepha, {
            register: { backupEligible: false },
            assert: { userVerified: false },
          }),
      },
      {
        name: "memory authenticator: holds two credentials and answers with the one asked for",
        expected: { ok: true, value: [true, true] },
        run: async (alepha) => {
          const device = alepha.inject(MemoryAuthenticator);
          device.origin = this.origin;
          const first = await device.create(this.registrationOptions("Y2gx"));
          const second = await device.create(this.registrationOptions("Y2gy"));
          const request = { challenge: "Y2gz", rpId: this.rpId };
          const a = await device.get(request, { credentialId: second.id });
          const b = await device.get({
            ...request,
            allowCredentials: [{ type: "public-key", id: first.id }],
          });
          return [a.id === second.id, b.id === first.id];
        },
      },
      {
        name: "memory authenticator: an excluded credential it holds is an InvalidStateError",
        expected: { ok: false, error: "InvalidStateError" },
        run: async (alepha) => {
          const device = alepha.inject(MemoryAuthenticator);
          device.origin = this.origin;
          const first = await device.create(this.registrationOptions("Y2gx"));
          return device.create({
            ...this.registrationOptions("Y2gy"),
            excludeCredentials: [{ type: "public-key", id: first.id }],
          });
        },
      },
      {
        name: "memory authenticator: no matching credential is a NotAllowedError",
        expected: { ok: false, error: "NotAllowedError" },
        run: (alepha) =>
          alepha
            .inject(MemoryAuthenticator)
            .get({ challenge: "Y2gx", rpId: this.rpId }),
      },
    );
  }

  protected addRefusals(): void {
    const w = "WEBAUTHN";
    const add = (
      name: string,
      expected: WebAuthnCaseOutcome,
      knobs: Parameters<MemoryAuthenticatorCases["ceremony"]>[1],
    ) =>
      this.cases.push({
        name: `generated refusal: ${name}`,
        expected,
        run: (alepha) => this.ceremony(alepha, knobs),
      });

    add("a base64url field with padding", this.refused(w, "encoding"), {
      mutateAssertion: (a) => ({
        ...a,
        response: { ...a.response, signature: `${a.response.signature}=` },
      }),
    });
    add("client data that is not JSON", this.refused(w, "clientData"), {
      mutateAssertion: (a) => ({
        ...a,
        response: { ...a.response, clientDataJSON: "bm90IGpzb24" },
      }),
    });
    add(
      "an attestation object that is not CBOR",
      this.refused("WEBAUTHN_CBOR", "cbor"),
      {
        mutateRegistration: (r) => ({
          ...r,
          response: { ...r.response, attestationObject: "nw" },
        }),
      },
    );
    add(
      "an attestation object that is not a map",
      this.refused(w, "attestation"),
      {
        mutateRegistration: (r) => ({
          ...r,
          response: { ...r.response, attestationObject: "AQ" },
        }),
      },
    );
    add("registration client data of the wrong type", this.refused(w, "type"), {
      register: { tamper: "type" },
    });
    add("assertion client data of the wrong type", this.refused(w, "type"), {
      assert: { tamper: "type" },
    });
    add(
      "a registration answering another challenge",
      this.refused(w, "challenge"),
      {
        register: { tamper: "challenge" },
      },
    );
    add(
      "an assertion answering another challenge",
      this.refused(w, "challenge"),
      {
        assert: { tamper: "challenge" },
      },
    );
    add("a registration from another origin", this.refused(w, "origin"), {
      register: { origin: "https://evil.example.test" },
    });
    add("an assertion from another origin", this.refused(w, "origin"), {
      assert: { origin: "https://evil.example.test" },
    });
    add(
      "an assertion from another host under a host rule",
      this.refused(w, "origin"),
      {
        assertion: { origin: { host: "other.example.test" } },
      },
    );
    add("a cross-origin assertion", this.refused(w, "crossOrigin"), {
      assert: { crossOrigin: true },
    });
    add("a registration for another RP id", this.refused(w, "rpId"), {
      register: { tamper: "rpId" },
    });
    add("an assertion for another RP id", this.refused(w, "rpId"), {
      assert: { tamper: "rpId" },
    });
    add(
      "a registration without user presence",
      this.refused(w, "userPresent"),
      {
        register: { userPresent: false },
      },
    );
    add("an assertion without user presence", this.refused(w, "userPresent"), {
      assert: { userPresent: false },
    });
    add(
      "an unverified registration when UV is required",
      this.refused(w, "userVerified"),
      {
        register: { userVerified: false },
        registration: { requireUserVerification: true },
      },
    );
    add(
      "an unverified assertion when UV is required",
      this.refused(w, "userVerified"),
      {
        assert: { userVerified: false },
        assertion: { requireUserVerification: true },
      },
    );
    add("truncated authenticator data", this.refused(w, "authenticatorData"), {
      mutateAssertion: (a) => ({
        ...a,
        response: {
          ...a.response,
          authenticatorData: a.response.authenticatorData.slice(0, 40),
        },
      }),
    });
    add(
      "a registration whose id is not the attested one",
      this.refused(w, "credential"),
      {
        mutateRegistration: (r) => ({ ...r, id: "AAAA", rawId: "AAAA" }),
      },
    );
    add(
      "an assertion whose id and rawId differ",
      this.refused(w, "credential"),
      {
        mutateAssertion: (a) => ({ ...a, rawId: "AAAA" }),
      },
    );
    add(
      "a packed self attestation with a broken signature",
      this.refused(w, "attestation"),
      {
        register: { attestation: "packed", tamper: "attestation" },
      },
    );
    for (const algorithm of ["ES256", "RS256", "EdDSA"] as const) {
      add(`a broken ${algorithm} signature`, this.refused(w, "signature"), {
        register: { algorithm },
        assert: { tamper: "signature" },
      });
    }
    add(
      "a replayed counter",
      this.refused("PASSKEY_COUNTER_REGRESSION", "counter"),
      {
        assert: { counter: 0 },
        assertion: { signCount: 3 },
      },
    );
    add(
      "a regressed counter",
      this.refused("PASSKEY_COUNTER_REGRESSION", "counter"),
      {
        register: { counter: 7 },
        assert: { counter: 4 },
      },
    );
    // `algorithm` is proven by the fixed vectors (ES384, ES512, Ed448) and
    // the COSE cases of the table: the authenticator only makes keys the
    // verifier accepts.
  }
}
