import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import {
  type FederationProfile,
  signFederationAssertion,
  verifyFederationAssertion,
} from "../helpers/federationAssertion.ts";

const profile: FederationProfile = {
  provider: "google",
  sub: "google-123",
  email: "p@example.com",
  email_verified: true,
  name: "Pat Player",
};

const keys = async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  return { priv: await exportPKCS8(privateKey), pub: await exportSPKI(publicKey) };
};

describe("federation assertion", () => {
  it("round-trips a signed assertion for the right audience", async () => {
    const { priv, pub } = await keys();
    const token = await signFederationAssertion(profile, {
      privateKeyPem: priv,
      issuer: "https://alepha.club",
      audience: "https://b14.alepha.club",
    });
    const out = await verifyFederationAssertion(token, {
      publicKeyPem: pub,
      issuer: "https://alepha.club",
      audience: "https://b14.alepha.club",
    });
    expect(out.profile).toMatchObject({
      provider: "google",
      sub: "google-123",
      email: "p@example.com",
    });
    expect(out.jti).toBeTruthy();
  });

  it("rejects a wrong audience (tenant mismatch)", async () => {
    const { priv, pub } = await keys();
    const token = await signFederationAssertion(profile, {
      privateKeyPem: priv,
      issuer: "https://alepha.club",
      audience: "https://b14.alepha.club",
    });
    await expect(
      verifyFederationAssertion(token, {
        publicKeyPem: pub,
        issuer: "https://alepha.club",
        audience: "https://other.alepha.club",
      }),
    ).rejects.toThrow();
  });

  it("rejects an expired assertion", async () => {
    const { priv, pub } = await keys();
    const token = await signFederationAssertion(profile, {
      privateKeyPem: priv,
      issuer: "https://alepha.club",
      audience: "https://b14.alepha.club",
      ttlSeconds: -1,
    });
    await expect(
      verifyFederationAssertion(token, {
        publicKeyPem: pub,
        issuer: "https://alepha.club",
        audience: "https://b14.alepha.club",
      }),
    ).rejects.toThrow();
  });
});
