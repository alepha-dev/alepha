import { importPKCS8, SignJWT } from "jose";

export interface AppleClientSecretOptions {
  privateKeyPem: string; // ES256 .p8 contents (PKCS#8 PEM)
  teamId: string; // Apple Team ID  -> iss
  serviceId: string; // Apple Service ID -> sub (the OAuth client_id)
  keyId: string; // Apple Key ID -> header kid
  ttlSeconds?: number; // default 300 (5 min)
}

/** Signs Apple's short-lived ES256 client_secret JWT on demand (no rotation job). */
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
