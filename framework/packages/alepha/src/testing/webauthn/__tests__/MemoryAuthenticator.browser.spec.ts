import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AuthenticatorDataParser } from "../../../security/providers/AuthenticatorDataParser.ts";
import { Base64Url } from "../../../security/providers/Base64Url.ts";
import { CborDecoder } from "../../../security/providers/CborDecoder.ts";
import { MemoryAuthenticator } from "../MemoryAuthenticator.ts";

/**
 * The UI specs of `@alepha/ui` drive the authenticator from a memory
 * `PasskeyClient` under jsdom: this pins that it runs there.
 */
describe("MemoryAuthenticator under jsdom", () => {
  it("creates and asserts with crypto.subtle", async ({ expect }) => {
    const alepha = Alepha.create();
    const device = alepha.inject(MemoryAuthenticator);
    const b64 = alepha.inject(Base64Url);
    device.origin = "http://localhost:3000";

    const created = await device.create({
      rp: { name: "Example" },
      user: { id: "dXNlcg", name: "ada", displayName: "Ada" },
      challenge: "Y2hhbGxlbmdl",
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    });
    const attestation = alepha
      .inject(CborDecoder)
      .decode(b64.decode(created.response.attestationObject)) as Map<
      string,
      unknown
    >;
    const authData = alepha
      .inject(AuthenticatorDataParser)
      .parse(attestation.get("authData") as Uint8Array);
    expect(attestation.get("fmt")).toBe("none");
    expect(authData.flags.attestedCredentialData).toBe(true);
    expect(b64.encode(authData.attestedCredential!.credentialId)).toBe(
      created.id,
    );

    const got = await device.get({ challenge: "c2Vjb25k" });
    expect(got.id).toBe(created.id);
    expect(
      alepha
        .inject(AuthenticatorDataParser)
        .parse(b64.decode(got.response.authenticatorData)).signCount,
    ).toBe(1);
  });
});
