/**
 * The `jose` types that `alepha/security` exposes in its public API.
 *
 * `jose` is bundled into `alepha`, not installed beside it, so a consumer has
 * no `jose` for a declaration file to import from: these are structural
 * copies of jose 6's own types, kept here so the `.d.ts` files never name it.
 * Algorithm names are `string`, which is what jose's open-ended unions
 * (`"HS256" | ... | (string & {})`) accept anyway.
 */

export interface JWK {
  kty?: string;
  alg?: string;
  key_ops?: string[];
  ext?: boolean;
  use?: string;
  x5c?: string[];
  x5t?: string;
  "x5t#S256"?: string;
  x5u?: string;
  kid?: string;
  crv?: string;
  d?: string;
  dp?: string;
  dq?: string;
  e?: string;
  k?: string;
  n?: string;
  p?: string;
  q?: string;
  qi?: string;
  x?: string;
  y?: string;
  pub?: string;
  priv?: string;
  oth?: Array<{ d?: string; r?: string; t?: string }>;
}

export interface JSONWebKeySet {
  keys: JWK[];
}

export interface JWTPayload {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  jti?: string;
  nbf?: number;
  exp?: number;
  iat?: number;
  [propName: string]: unknown;
}

export interface JWSHeaderParameters {
  kid?: string;
  x5t?: string;
  x5c?: string[];
  x5u?: string;
  jku?: string;
  jwk?: Omit<JWK, "d" | "dp" | "dq" | "k" | "p" | "q" | "qi" | "priv" | "oth">;
  typ?: string;
  cty?: string;
  alg?: string;
  b64?: boolean;
  crit?: string[];
  [propName: string]: unknown;
}

export interface JWTHeaderParameters extends JWSHeaderParameters {
  alg: string;
}

export interface FlattenedJWSInput {
  header?: JWSHeaderParameters;
  payload: string | Uint8Array;
  protected?: string;
  signature: string;
}

export interface JWTVerifyResult<PayloadType = JWTPayload> {
  payload: PayloadType & JWTPayload;
  protectedHeader: JWTHeaderParameters;
}

export interface JWTVerifyOptions {
  algorithms?: string[];
  crit?: { [propName: string]: boolean };
  audience?: string | string[];
  clockTolerance?: string | number;
  issuer?: string | string[];
  maxTokenAge?: string | number;
  subject?: string;
  typ?: string;
  currentDate?: Date;
  requiredClaims?: string[];
}

export interface KeyObject {
  type: string;
}

/**
 * The runtime's WebCrypto `CryptoKey`, resolved the way jose resolves it so
 * the type exists whether or not the consumer loads the DOM lib.
 */
export type CryptoKey = typeof globalThis extends {
  crypto: { subtle: { generateKey(...args: any[]): Promise<infer R> } };
}
  ? Extract<R, { type: string }>
  : {
      readonly algorithm: { name: string };
      readonly extractable: boolean;
      readonly type: string;
      readonly usages: string[];
    };
