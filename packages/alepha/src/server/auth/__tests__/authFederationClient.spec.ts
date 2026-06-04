import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { signFederationAssertion } from "../helpers/federationAssertion.ts";
import { assertionToProfile } from "../primitives/$authFederationClient.ts";

describe("federation client mapping", () => {
  it("maps a verified assertion to a LinkAccountOptions profile", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    const priv = await exportPKCS8(privateKey);
    const pub = await exportSPKI(publicKey);
    const token = await signFederationAssertion(
      {
        provider: "google",
        sub: "g-1",
        email: "x@y.z",
        email_verified: true,
        name: "X Y",
      },
      {
        privateKeyPem: priv,
        issuer: "https://alepha.club",
        audience: "https://b14.alepha.club",
      },
    );
    const { provider, link } = await assertionToProfile(token, {
      publicKeyPem: pub,
      issuer: "https://alepha.club",
      audience: "https://b14.alepha.club",
    });
    expect(provider).toBe("google");
    expect(link.user).toMatchObject({
      sub: "g-1",
      email: "x@y.z",
      email_verified: true,
    });
  });
});
