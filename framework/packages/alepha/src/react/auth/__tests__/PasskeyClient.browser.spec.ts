import { Alepha } from "alepha";
import { afterEach, describe, it } from "vitest";

import { PasskeyClient } from "../services/PasskeyClient.ts";

/**
 * `PasskeyClient` against a stand-in for the browser's WebAuthn globals:
 * the browser's own JSON helpers when it has them, the hand conversion
 * when it does not (older Safari and Chromium), and the errors a ceremony
 * can end with.
 */
describe("PasskeyClient", () => {
  const original = {
    pkc: (globalThis as any).PublicKeyCredential,
    credentials: Object.getOwnPropertyDescriptor(navigator, "credentials"),
  };

  afterEach(() => {
    (globalThis as any).PublicKeyCredential = original.pkc;
    if (original.credentials) {
      Object.defineProperty(navigator, "credentials", original.credentials);
    } else {
      delete (navigator as any).credentials;
    }
  });

  const install = (options: {
    parse?: boolean;
    create?: (init: any) => Promise<unknown>;
    get?: (init: any) => Promise<unknown>;
  }) => {
    const seen: any[] = [];
    const pkc: any = function PublicKeyCredential() {};
    pkc.isConditionalMediationAvailable = async () => true;
    if (options.parse) {
      pkc.parseCreationOptionsFromJSON = (json: any) => ({
        parsed: true,
        ...json,
      });
      pkc.parseRequestOptionsFromJSON = (json: any) => ({
        parsed: true,
        ...json,
      });
    }
    (globalThis as any).PublicKeyCredential = pkc;
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        create: async (init: any) => {
          seen.push(init);
          return options.create?.(init);
        },
        get: async (init: any) => {
          seen.push(init);
          return options.get?.(init);
        },
      },
    });
    return seen;
  };

  const registration = {
    rp: { name: "Example" },
    user: { id: "dXNlcg", name: "ada", displayName: "Ada" },
    challenge: "Y2hhbGxlbmdl",
    pubKeyCredParams: [{ type: "public-key" as const, alg: -7 }],
    excludeCredentials: [{ type: "public-key" as const, id: "AQID" }],
  };

  const bytes = (...values: number[]) => new Uint8Array(values).buffer;

  it("converts by hand, both ways, where the browser has no JSON helpers", async ({
    expect,
  }) => {
    const seen = install({
      create: async () => ({
        id: "AQID",
        rawId: bytes(1, 2, 3),
        type: "public-key",
        response: {
          clientDataJSON: bytes(123, 125),
          attestationObject: bytes(160),
          getTransports: () => ["internal"],
        },
        getClientExtensionResults: () => ({}),
      }),
    });
    const client = Alepha.create().inject(PasskeyClient);

    const result = await client.create(registration);

    const publicKey = seen[0].publicKey;
    expect(publicKey.challenge).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(publicKey.user.id))).toEqual(
      Array.from(new TextEncoder().encode("user")),
    );
    expect(
      Array.from(new Uint8Array(publicKey.excludeCredentials[0].id)),
    ).toEqual([1, 2, 3]);
    expect(result).toEqual({
      ok: true,
      value: {
        id: "AQID",
        rawId: "AQID",
        type: "public-key",
        authenticatorAttachment: undefined,
        clientExtensionResults: {},
        response: {
          clientDataJSON: "e30",
          attestationObject: "oA",
          transports: ["internal"],
        },
      },
    });
  });

  it("uses the browser's JSON helpers where it has them", async ({
    expect,
  }) => {
    const seen = install({
      parse: true,
      get: async () => ({ toJSON: () => ({ id: "from-toJSON" }) }),
    });
    const client = Alepha.create().inject(PasskeyClient);

    const result = await client.get(
      { challenge: "Y2hhbGxlbmdl" },
      { mediation: "conditional" },
    );

    expect(seen[0].publicKey.parsed).toBe(true);
    expect(seen[0].mediation).toBe("conditional");
    expect(result).toEqual({ ok: true, value: { id: "from-toJSON" } });
    expect(await client.isAutofillSupported()).toBe(true);
  });

  it("maps a dismissal to a quiet cancel and a known device to exists", async ({
    expect,
  }) => {
    const fail = (name: string) => async () => {
      throw new DOMException("no", name);
    };
    install({
      create: fail("InvalidStateError"),
      get: fail("NotAllowedError"),
    });
    const client = Alepha.create().inject(PasskeyClient);

    expect(await client.create(registration)).toEqual({
      ok: false,
      reason: "exists",
    });
    expect(await client.get({ challenge: "Yw" })).toEqual({
      ok: false,
      reason: "cancelled",
    });
  });

  it("reports unsupported where the browser has no WebAuthn", async ({
    expect,
  }) => {
    (globalThis as any).PublicKeyCredential = undefined;
    const client = Alepha.create().inject(PasskeyClient);
    expect(client.isSupported()).toBe(false);
    expect(await client.get({ challenge: "Yw" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});
