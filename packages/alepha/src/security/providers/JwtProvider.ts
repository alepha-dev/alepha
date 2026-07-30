import { createSecretKey } from "node:crypto";
import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  type CryptoKey,
  createLocalJWKSet,
  createRemoteJWKSet,
  exportJWK,
  type FlattenedJWSInput,
  generateKeyPair,
  importPKCS8,
  type JSONWebKeySet,
  type JWK,
  type JWSHeaderParameters,
  type JWTHeaderParameters,
  type JWTPayload,
  type JWTVerifyResult,
  jwtVerify,
  type KeyObject,
  SignJWT,
} from "jose";
import { JWTClaimValidationFailed, JWTExpired } from "jose/errors";
import type { JWTVerifyOptions } from "jose/jwt/verify";
import { InvalidTokenError } from "../errors/InvalidTokenError.ts";

/**
 * Provides utilities for working with JSON Web Tokens (JWT).
 */
export class JwtProvider {
  protected readonly log = $logger();
  protected readonly keystore: KeyLoaderHolder[] = [];
  protected readonly signers = new Map<string, SignerHolder>();
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly encoder = new TextEncoder();

  /**
   * `typ` header stamped on every access token we mint, and required of any
   * JWT presented as a Bearer for a realm we sign for. See `isAccessToken`.
   */
  public readonly accessTokenTyp = "access";

  /**
   * True when this process holds the signing key for `name` — i.e. every valid
   * token for that realm was minted here, so its `typ` header is ours to trust.
   */
  public isTokenIssuer(name: string): boolean {
    return (
      this.signers.has(name) ||
      this.keystore.some((it) => it.name === name && !!it.secretKey)
    );
  }

  /**
   * Guard against token-type confusion. A realm we sign for mints several
   * kinds of JWT with the SAME key: access tokens, refresh tokens
   * (`typ: "refresh"`), OAuth authorization codes (`typ: "oauth_code"`) and
   * id_tokens (`typ: "JWT"`). Without this check every one of them
   * authenticates as its subject — which deletes PKCE, because merely seeing a
   * code (browser history, `Referer`, proxy logs) would be enough to act as
   * the user, with no `code_verifier` and without touching `/oauth/token`.
   *
   * Enforced only for realms whose key we hold: an external IdP picks its own
   * `typ`, so requiring ours would reject every federated token.
   */
  public isAccessToken(name: string, header: { typ?: string }): boolean {
    if (!this.isTokenIssuer(name)) {
      return true;
    }
    return header.typ === this.accessTokenTyp;
  }

  /**
   * Adds a key loader to the embedded keystore.
   *
   * @param name
   * @param secretKeyOrJwks
   */
  public setKeyLoader(name: string, secretKeyOrJwks: string | JSONWebKeySet) {
    if (typeof secretKeyOrJwks === "object") {
      this.log.debug(`will verify JWTs from key '${name}' with JWKS object`);
      this.keystore.push({
        name,
        keyLoader: createLocalJWKSet(secretKeyOrJwks),
      });
    } else if (this.isSecretKey(secretKeyOrJwks)) {
      const secretKey = this.encoder.encode(secretKeyOrJwks);
      this.log.debug(`will verify JWTs from issuer '${name}' with secret key`);
      this.keystore.push({
        name,
        secretKey: secretKeyOrJwks,
        keyLoader: () => Promise.resolve(createSecretKey(secretKey)),
        // We only ever sign symmetric tokens with HS256 — pin it so a future
        // key-loader change can't widen the accepted set.
        algorithms: ["HS256"],
      });
    } else {
      this.log.debug(`will verify JWTs from issuer '${name}' with JWKS`, {
        url: secretKeyOrJwks,
      });
      this.keystore.push({
        name,
        keyLoader: createRemoteJWKSet(new URL(secretKeyOrJwks)),
      });
    }
  }

  /**
   * Configure an asymmetric signing key for a realm/issuer. Tokens minted for
   * `name` are then signed with `alg` + `kid`, and a local verify loader is
   * registered so this process can verify its own tokens (refresh tokens,
   * authorization codes, id_tokens). Public keys are published via `getJwks`.
   *
   * `privateKey` is a PKCS#8 PEM (from env). When it is empty/undefined an
   * **ephemeral per-process keypair** is generated so dev/test work with no env
   * key configured — the published JWKS still resolves; tokens just don't
   * survive a restart. Additive: realms without a signing key keep the HS256
   * path untouched.
   */
  public async setSigningKey(
    name: string,
    signing: SigningConfig,
  ): Promise<void> {
    const key = signing.privateKey
      ? await importPKCS8(signing.privateKey, signing.alg, {
          extractable: true,
        })
      : (await generateKeyPair(signing.alg, { extractable: true })).privateKey;
    const exported = await exportJWK(key);
    // Strip every private member so the published JWK is public-only.
    const { d, p, q, dp, dq, qi, ...pub } = exported as Record<string, unknown>;
    const publicJwk: JWK = {
      ...(pub as JWK),
      kid: signing.kid,
      use: "sig",
      alg: signing.alg,
    };

    this.signers.set(name, {
      alg: signing.alg,
      kid: signing.kid,
      key,
      publicJwk,
    });

    this.log.debug(`will sign + verify JWTs for '${name}'`, {
      alg: signing.alg,
      kid: signing.kid,
    });

    // Register a local verify loader so tokens we sign can be verified.
    this.keystore.push({
      name,
      keyLoader: createLocalJWKSet({ keys: [publicJwk] }),
      algorithms: [signing.alg],
    });
  }

  /**
   * Public JWK Set for a realm/issuer configured with an asymmetric signing
   * key. Returns an empty set for HS256 / external (URL-based) realms.
   */
  public async getJwks(name: string): Promise<JSONWebKeySet> {
    const signer = this.signers.get(name);
    return { keys: signer ? [signer.publicJwk] : [] };
  }

  /**
   * Retrieves the payload from a JSON Web Token (JWT).
   *
   * @param token - The JWT to extract the payload from.
   *
   * @return A Promise that resolves with the payload object from the token.
   */
  public async parse(
    token: string,
    keyName?: string,
    options?: JWTVerifyOptions,
  ): Promise<JwtParseResult> {
    for (const it of this.keystore) {
      if (keyName && it.name !== keyName) {
        continue;
      }

      this.log.trace(`Trying to verify token`, {
        keyName: it.name,
        options,
      });

      try {
        const verified = {
          keyName: it.name,
          result: await jwtVerify(token, it.keyLoader, {
            currentDate: this.dateTimeProvider.now().toDate(),
            ...(it.algorithms ? { algorithms: it.algorithms } : {}),
            ...options,
          }),
        };

        this.log.trace("Token verified successfully", {
          keyName: verified.keyName,
        });

        return verified;
      } catch (error) {
        this.log.trace("Token verification has failed", error);

        if (error instanceof JWTExpired) {
          throw new InvalidTokenError("Token expired", { cause: error });
        }

        if (error instanceof JWTClaimValidationFailed) {
          throw new InvalidTokenError("Token claim validation failed", {
            cause: error,
          });
        }
      }
    }

    this.log.warn(
      `No valid key loader found to verify the token (keystore size: ${this.keystore.length})`,
    );

    throw new InvalidTokenError("Invalid token");
  }

  /**
   * Creates a JWT token with the provided payload and secret key.
   *
   * @param payload - The payload to be encoded in the token.
   * 	It should include the `realm_access` property which contains an array of roles.
   * @param keyName - The name of the key to use when signing the token.
   *
   * @returns The signed JWT token.
   */
  public async create(
    payload: ExtendedJWTPayload,
    keyName?: string,
    signOptions?: JwtSignOptions,
  ): Promise<string> {
    // Asymmetric path: when a signing key is configured for this realm, sign
    // with its alg + kid so the token verifies against the published JWKS.
    const signerName = keyName ?? this.keystore[0]?.name;
    const signer = signerName ? this.signers.get(signerName) : undefined;
    if (signer) {
      const signJwt = new SignJWT(payload);
      signJwt.setProtectedHeader({
        alg: signer.alg,
        kid: signer.kid,
        ...signOptions?.header,
      });
      return await signJwt.sign(signer.key);
    }

    // HS256 path (unchanged default).
    const secretKey = keyName
      ? this.keystore.find((it) => it.name === keyName)?.secretKey
      : this.keystore[0]?.secretKey;

    if (!secretKey) {
      throw new AlephaError("No secret key found in the keystore");
    }

    const signJwt = new SignJWT(payload);

    signJwt.setProtectedHeader({
      alg: "HS256",
      ...signOptions?.header,
    });

    return await signJwt.sign(this.encoder.encode(secretKey));
  }

  /**
   * Determines if the provided key is a secret key.
   *
   * @param key
   * @protected
   */
  protected isSecretKey(key: string): boolean {
    return !key.startsWith("http://") && !key.startsWith("https://");
  }
}

export type KeyLoader = (
  protectedHeader?: JWSHeaderParameters,
  token?: FlattenedJWSInput,
) => Promise<CryptoKey | KeyObject>;

export interface KeyLoaderHolder {
  name: string;
  keyLoader: KeyLoader;
  secretKey?: string;
  /**
   * Accepted JWS algorithms for this key, pinned at registration when we know
   * exactly what we sign with. Left undefined for external JWKS URLs, whose
   * IdP chooses its own algorithm (RS256/ES256/…) and may rotate it.
   */
  algorithms?: string[];
}

export interface SignerHolder {
  alg: string;
  kid: string;
  key: CryptoKey | KeyObject;
  publicJwk: JWK;
}

/**
 * Asymmetric signing config for a realm/issuer. `privateKey` is a PKCS#8 PEM
 * (typically injected from env). EdDSA preferred; RS256 acceptable.
 */
export interface SigningConfig {
  alg: "EdDSA" | "RS256";
  /**
   * PKCS#8 PEM private key. Empty/undefined → an ephemeral per-process keypair
   * is generated (dev/test convenience; tokens don't survive a restart).
   */
  privateKey?: string;
  kid: string;
}

export interface JwtSignOptions {
  header?: Partial<JWTHeaderParameters>;
}

export interface ExtendedJWTPayload extends JWTPayload {
  sid?: string;
  //
  name?: string;
  roles?: string[];
  email?: string;
  organization?: string;
  // keycloak specific
  realm_access?: { roles: string[] };
}

export interface JwtParseResult {
  keyName: string;
  result: JWTVerifyResult<ExtendedJWTPayload>;
}
