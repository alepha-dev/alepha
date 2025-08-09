import { createSecretKey } from "node:crypto";
import { $inject, $logger } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import {
	type CryptoKey,
	createLocalJWKSet,
	createRemoteJWKSet,
	type FlattenedJWSInput,
	type JSONWebKeySet,
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
import { SecurityError } from "../errors/SecurityError.ts";

/**
 * Provides utilities for working with JSON Web Tokens (JWT).
 */
export class JwtProvider {
	protected readonly log = $logger();
	protected readonly keystore: KeyLoaderHolder[] = [];
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly encoder = new TextEncoder();

	/**
	 * Adds a key loader to the embedded keystore.
	 *
	 * @param name
	 * @param secretKeyOrJwks
	 */
	public setKeyLoader(name: string, secretKeyOrJwks: string | JSONWebKeySet) {
		if (typeof secretKeyOrJwks === "object") {
			this.log.info(
				`will verify JWTs '${name}' with JWKS object [x${secretKeyOrJwks.keys.length}]`,
			);
			this.keystore.push({
				name,
				keyLoader: createLocalJWKSet(secretKeyOrJwks),
			});
		} else if (this.isSecretKey(secretKeyOrJwks)) {
			const secretKey = this.encoder.encode(secretKeyOrJwks);
			this.log.info(
				`will verify JWTs from '${name}' with secret a key (${secretKey.length} bytes)`,
			);
			this.keystore.push({
				name,
				secretKey: secretKeyOrJwks,
				keyLoader: () => Promise.resolve(createSecretKey(secretKey)),
			});
		} else {
			this.log.info(`will verify JWTs '${name}' with ${secretKeyOrJwks}`);
			this.keystore.push({
				name,
				keyLoader: createRemoteJWKSet(new URL(secretKeyOrJwks)),
			});
		}
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
			});

			try {
				const verified = {
					keyName: it.name,
					result: await jwtVerify(token, it.keyLoader, {
						currentDate: this.dateTimeProvider.now().toDate(),
						...options,
					}),
				};

				this.log.trace("Token verified successfully", {
					keyName: verified.keyName,
				});

				return verified;
			} catch (error) {
				if (error instanceof JWTExpired) {
					throw new SecurityError("Token expired", { cause: error });
				}
				if (error instanceof JWTClaimValidationFailed) {
					throw new SecurityError("Token claim validation failed", {
						cause: error,
					});
				}
				this.log.trace(error);
			}
		}

		this.log.warn(
			`No valid key loader found to verify the token (keystore size: ${this.keystore.length})`,
		);

		throw new SecurityError("Invalid token");
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
		const secretKey = keyName
			? this.keystore.find((it) => it.name === keyName)?.secretKey
			: this.keystore[0]?.secretKey;

		if (!secretKey) {
			throw new Error("No secret key found in the keystore");
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
		return !key.startsWith("http");
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
}

export interface JwtSignOptions {
	header?: Partial<JWTHeaderParameters>;
}

export interface ExtendedJWTPayload extends JWTPayload {
	name?: string;
	roles?: string[];
	email?: string;
	organizations?: string[];
	// keycloak specific
	realm_access?: { roles: string[] };
}

export interface JwtParseResult {
	keyName: string;
	result: JWTVerifyResult<ExtendedJWTPayload>;
}
