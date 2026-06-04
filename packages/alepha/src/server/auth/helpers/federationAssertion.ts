import { importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";

const ALG = "EdDSA";

export interface FederationProfile {
  provider: "google" | "apple";
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  is_private_email?: boolean;
}

export interface SignAssertionOptions {
  privateKeyPem: string; // EdDSA PKCS#8 PEM
  issuer: string;
  audience: string; // exact tenant origin
  ttlSeconds?: number; // default 60
  jti?: string; // default random
}

export interface VerifyAssertionOptions {
  publicKeyPem: string; // EdDSA SPKI PEM
  issuer: string;
  audience: string;
}

export interface VerifiedAssertion {
  profile: FederationProfile;
  jti: string;
}

export async function signFederationAssertion(
  profile: FederationProfile,
  opts: SignAssertionOptions,
): Promise<string> {
  const key = await importPKCS8(opts.privateKeyPem, ALG);
  const jti = opts.jti ?? crypto.randomUUID();
  const ttl = opts.ttlSeconds ?? 60;
  return new SignJWT({ profile })
    .setProtectedHeader({ alg: ALG, typ: "JWT" })
    .setIssuer(opts.issuer)
    .setAudience(opts.audience)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(key);
}

export async function verifyFederationAssertion(
  token: string,
  opts: VerifyAssertionOptions,
): Promise<VerifiedAssertion> {
  const key = await importSPKI(opts.publicKeyPem, ALG);
  const { payload } = await jwtVerify(token, key, {
    issuer: opts.issuer,
    audience: opts.audience,
    algorithms: [ALG],
    // Defense-in-depth: reject a (signature-valid) token that omits any of
    // these, so it can't slip an unbounded lifetime or an unreplayable id.
    requiredClaims: ["exp", "iat", "jti"],
  });
  const profile = payload.profile as FederationProfile | undefined;
  if (!profile?.sub || !profile.provider) {
    throw new Error("Federation assertion missing profile.sub/provider");
  }
  if (!payload.jti) {
    throw new Error("Federation assertion missing jti");
  }
  return { profile, jti: String(payload.jti) };
}
