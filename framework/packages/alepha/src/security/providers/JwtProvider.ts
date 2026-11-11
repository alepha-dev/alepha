import { createSecretKey } from "node:crypto";

import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  exportJWK,
  generateKeyPair,
  importPKCS8,
  jwtVerify,
  SignJWT,
} from "jose";
import type {
  CryptoKey,
  FlattenedJWSInput,
  JSONWebKeySet,
  JWK,
  JWSHeaderParameters,
  JWTHeaderParameters,
  JWTPayload,
  JWTVerifyOptions,
  JWTVerifyResult,
  KeyObject,
} from "jose";
import { JWTClaimValidationFailed, JWTExpired } from "jose/errors";

import { InvalidTokenError } from "../errors/InvalidTokenError.ts";
import type {
  OidcIssuerSource,
  TokenExpectation,
} from "../interfaces/OidcIssuerSource.ts";

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
   * Anti-replay across realms. A token minted by realm B must not
   * authenticate on realm A.
   *
   * Nothing else stops it. Every realm in an application signs with the same
   * key by default, so B's signature verifies under A; the resolvers then run
   * in priority order and the FIRST one to verify claims the request, which
   * resolves the caller as A and substitutes A's roles for their own. Measured
   * with two realms: a token minted `aud=staff roles=["pending","admin"]`
   * resolved as `realm=citizens roles=["user"]`. It happened to fail closed
   * there only because the wrong realm granted less, and which realm is
   * declared first is an accident.
   *
   * `createToken` sets `aud` to the issuing realm's name, so comparing it
   * against the resolving realm is the whole check.
   *
   * Enforced only for realms whose key we hold, exactly like
   * {@link JwtProvider.isAccessToken}: an external IdP sets `aud` to its own
   * client id, so requiring ours would reject every federated token. A
   * federated realm is protected by its own JWKS instead - another IdP's
   * token does not verify against it.
   */
  public matchesRealmAudience(
    name: string,
    payload: { aud?: string | string[] },
  ): boolean {
    if (!this.isTokenIssuer(name)) {
      return true;
    }
    const { aud } = payload;

    // A token carrying no audience names no realm. That is unambiguous only
    // while there is one realm to name: `JwtProvider.create` is public API and
    // an application minting its own token has no reason to set `aud` in a
    // single-realm app, so refusing it there would be a break with nothing
    // bought. With two realms the same token is claimed by whichever resolver
    // runs first, which is the fault this method exists to close.
    if (aud === undefined) {
      return this.signedRealmNames().size <= 1;
    }

    return Array.isArray(aud) ? aud.includes(name) : aud === name;
  }

  /**
   * The realms this process signs for - the ones whose tokens it mints, and
   * therefore the ones an `aud` claim can disambiguate. A federated issuer is
   * not among them: it holds a JWKS, not a key of ours.
   */
  protected signedRealmNames(): Set<string> {
    const names = new Set<string>(this.signers.keys());
    for (const it of this.keystore) {
      if (it.secretKey) {
        names.add(it.name);
      }
    }
    return names;
  }

  /**
   * Adds a key loader to the embedded keystore.
   *
   * `expect` is what a federated realm's tokens must carry beyond a valid
   * signature: an issuer, an audience. A JWKS realm registered without an
   * expected issuer warns once, here: it accepts any token its keys verify.
   *
   * @param name
   * @param secretKeyOrJwks
   * @param expect
   */
  public setKeyLoader(
    name: string,
    secretKeyOrJwks: string | JSONWebKeySet,
    expect?: TokenExpectation,
  ) {
    if (typeof secretKeyOrJwks === "object") {
      this.log.debug(`will verify JWTs from key '${name}' with JWKS object`);
      this.keystore.push({
        name,
        keyLoader: createLocalJWKSet(secretKeyOrJwks),
        ...this.expectation(expect),
      });
      this.warnWithoutIssuer(name, expect);
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
        ...this.expectation(expect),
      });
      this.warnWithoutIssuer(name, expect);
    }
  }

  /**
   * Adds a federated realm fed by an OIDC provider's discovery.
   *
   * Nothing is fetched here: a relying party must boot while its provider is
   * unreachable. The first token verified runs discovery, which gives the
   * expected issuer and the JWKS url, and one remote JWKS is built from it
   * and kept. A failed discovery refuses that token and is not remembered,
   * so the next one tries again (`getOAuth` keeps its initializer until it
   * succeeds).
   *
   * The token must carry the discovered issuer, and name the client in `aud`
   * or else in `azp`. `overrides` replaces either default.
   */
  public setOidcKeyLoader(
    name: string,
    source: () => OidcIssuerSource,
    overrides?: TokenExpectation,
  ): void {
    this.log.debug(
      `will verify JWTs from issuer '${name}' with OIDC discovery`,
    );
    this.keystore.push(this.createOidcKeyLoader(name, source, overrides));
  }

  /**
   * The keystore entry {@link JwtProvider.setOidcKeyLoader} registers, built
   * without registering it: for a token verified against a provider outside
   * any realm, such as a back-channel logout token, with
   * {@link JwtProvider.verifyWith}.
   */
  public createOidcKeyLoader(
    name: string,
    source: () => OidcIssuerSource,
    overrides?: TokenExpectation,
  ): KeyLoaderHolder {
    let remote: KeyLoader | undefined;

    const metadata = async () => {
      const oauth = await source().getOAuth();
      if (!oauth) {
        throw new AlephaError(
          `The OIDC provider of issuer '${name}' has no discovery`,
        );
      }
      return oauth.serverMetadata();
    };

    return {
      name,
      keyLoader: async (header, token) => {
        if (!remote) {
          const { jwks_uri } = await metadata();
          if (!jwks_uri) {
            throw new AlephaError(
              `The OIDC provider of issuer '${name}' advertises no jwks_uri`,
            );
          }
          remote = createRemoteJWKSet(new URL(jwks_uri)) as KeyLoader;
        }
        return remote(header, token);
      },
      expected: async () => {
        const { issuer } = await metadata();
        const { clientId } = source();
        return {
          issuer: overrides?.issuer ?? issuer,
          audience: overrides?.audience ?? clientId,
          clientId,
        };
      },
    };
  }

  /**
   * Verify a token against one keystore entry: its signature, its expiry, and
   * the entry's expectations (issuer, client). Throws whatever failed, as
   * jose raised it or as an `InvalidTokenError` for the client check.
   */
  public async verifyWith(
    entry: KeyLoaderHolder,
    token: string,
    options?: JWTVerifyOptions,
  ): Promise<JWTVerifyResult<ExtendedJWTPayload>> {
    // A federated realm's expectations: resolved per token, since an OIDC
    // realm knows its issuer only after discovery.
    const expected = await entry.expected?.();

    const result = await jwtVerify<ExtendedJWTPayload>(token, entry.keyLoader, {
      currentDate: this.dateTimeProvider.now().toDate(),
      ...(entry.algorithms ? { algorithms: entry.algorithms } : {}),
      ...(expected?.issuer ? { issuer: expected.issuer } : {}),
      ...options,
    });

    if (expected && !this.matchesExpectedClient(result.payload, expected)) {
      throw new InvalidTokenError("Token was issued to another client");
    }

    return result;
  }

  protected expectation(
    expect?: TokenExpectation,
  ): Pick<KeyLoaderHolder, "expected"> {
    if (!expect?.issuer && !expect?.audience) {
      return {};
    }
    return { expected: () => Promise.resolve(expect) };
  }

  protected warnWithoutIssuer(name: string, expect?: TokenExpectation): void {
    if (!expect?.issuer) {
      this.log.warn(
        `Issuer '${name}' verifies tokens against a JWKS with no expected issuer: any token those keys verify is accepted. Set issuer and audience on its $issuer, or use $issuer({ oidc }).`,
      );
    }
  }

  /**
   * The client check of a federated token: `aud` carries one of the expected
   * audiences, or, failing that, `azp` names the client.
   */
  public matchesExpectedClient(
    payload: { aud?: string | string[]; azp?: unknown },
    expected: TokenExpectation,
  ): boolean {
    const audiences =
      expected.audience === undefined ? [] : [expected.audience].flat();
    const client =
      expected.clientId ?? (audiences.length === 1 ? audiences[0] : undefined);
    if (audiences.length === 0 && !client) {
      return true;
    }

    const aud = payload.aud === undefined ? [] : [payload.aud].flat();
    if (audiences.some((it) => aud.includes(it))) {
      return true;
    }

    return !!client && payload.azp === client;
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
          result: await this.verifyWith(it, token, options),
        };

        this.log.trace("Token verified successfully", {
          keyName: verified.keyName,
        });

        return verified;
      } catch (error) {
        this.log.trace("Token verification has failed", error);

        if (error instanceof InvalidTokenError) {
          throw error;
        }

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
  /**
   * What a token must carry beyond a valid signature, for a federated realm:
   * resolved on each verification, because an OIDC realm learns its issuer
   * from discovery.
   */
  expected?: () => Promise<TokenExpectation>;
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
  // keycloak specific
  realm_access?: { roles: string[] };
}

export interface JwtParseResult {
  keyName: string;
  result: JWTVerifyResult<ExtendedJWTPayload>;
}
