import { importPKCS8, SignJWT } from "jose";

export interface AppleClientSecretOptions {
  /**
   * The contents of the ES256 `.p8` key (PKCS#8 PEM).
   */
  privateKeyPem: string;

  /**
   * Apple Team ID: the token's `iss`.
   */
  teamId: string;

  /**
   * Apple Service ID, which is the OAuth `client_id`: the token's `sub`.
   */
  serviceId: string;

  /**
   * Apple Key ID: the `kid` of the token's header.
   */
  keyId: string;

  /**
   * Lifetime of the token in seconds.
   * @default 300
   */
  ttlSeconds?: number;
}

/**
 * Signs Apple's short-lived ES256 client_secret JWT on demand (no rotation
 * job). `$authApple` does not call it: it reads a secret generated ahead of
 * time from `APPLE_CLIENT_SECRET`.
 */
export async function signAppleClientSecret(
  opts: AppleClientSecretOptions,
): Promise<string> {
  const key = await importPKCS8(opts.privateKeyPem, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: opts.keyId, typ: "JWT" })
    .setIssuer(opts.teamId)
    .setSubject(opts.serviceId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt()
    .setExpirationTime(`${opts.ttlSeconds ?? 300}s`)
    .sign(key);
}
