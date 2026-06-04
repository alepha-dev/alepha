import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { signAppleClientSecret } from "../helpers/appleClientSecret.ts";

describe("apple client secret", () => {
  it("signs an ES256 JWT with the Apple-required claims + kid header", async () => {
    const { privateKey } = await generateKeyPair("ES256", {
      crv: "P-256",
      extractable: true,
    });
    const pem = await exportPKCS8(privateKey);
    const secret = await signAppleClientSecret({
      privateKeyPem: pem,
      teamId: "TEAM123456",
      serviceId: "club.alepha.signin",
      keyId: "KEY1234567",
    });
    const claims = decodeJwt(secret);
    expect(claims.iss).toBe("TEAM123456");
    expect(claims.sub).toBe("club.alepha.signin");
    expect(claims.aud).toBe("https://appleid.apple.com");
    expect(typeof claims.exp).toBe("number");
  });
});
