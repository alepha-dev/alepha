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
import { JWTExpired } from "jose/errors";
import { SecurityError } from "../errors/SecurityError.ts";

/**
 * Provides utilities for working with JSON Web Tokens (JWT).
 */
export class JwtProvider {
	protected readonly log = $logger();
	protected readonly keystore: KeyLoaderHolder[] = [];
	protected readonly dateTimeProvider = $inject(DateTimeProvider);

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
			this.log.info(`will verify JWTs '${name}' with secret key`);
			this.keystore.push({
				name,
				secretKey: secretKeyOrJwks,
				keyLoader: () =>
					Promise.resolve(
						createSecretKey(new TextEncoder().encode(secretKeyOrJwks)),
					),
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
	public async parse(token: string): Promise<JwtParseResult> {
		if (this.keystore.length > 1) {
			const keyLoaderHolder = this.tryToGetKeyLoaderFromToken(token);
			if (keyLoaderHolder) {
				try {
					return {
						result: await jwtVerify(token, keyLoaderHolder.keyLoader),
						keyName: keyLoaderHolder.name,
					};
				} catch (error) {
					throw new SecurityError("Invalid token", { cause: error });
				}
			}
		}

		for (const it of this.keystore) {
			this.log.trace(`Trying to verify token`, {
				keyName: it.name,
			});

			try {
				const verified = {
					keyName: it.name,
					result: await jwtVerify(token, it.keyLoader, {
						currentDate: this.dateTimeProvider.now().toDate(),
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
	 * @param signOptions - The options to use when signing the token.
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
			: this.getFirstSecretKey();

		if (!secretKey) {
			throw new Error("No secret key found in the keystore");
		}

		const options: JwtSignOptions = Object.assign(
			{},
			this.signOptions(),
			signOptions,
		);

		const signJwt = new SignJWT(payload);

		if (options.issuedAt) {
			signJwt.setIssuedAt();
		}

		if (options.expiresIn) {
			signJwt.setExpirationTime(options.expiresIn);
		}

		if (options.protectedHeader) {
			signJwt.setProtectedHeader(options.protectedHeader);
		}

		return await signJwt.sign(new TextEncoder().encode(secretKey));
	}

	/**
	 * Retrieves the options to use when signing a JWT token.
	 *
	 * @returns The JWT sign options.
	 */
	public signOptions(): JwtSignOptions {
		return {
			issuedAt: true,
			protectedHeader: { alg: "HS256" },
			expiresIn: this.dateTimeProvider.now().add(2, "hour").unix(),
		};
	}

	/**
	 * Retrieves the first secret key from the keystore.
	 *
	 * @protected
	 */
	protected getFirstSecretKey(): string | undefined {
		for (const key of this.keystore) {
			if (key.secretKey) {
				return key.secretKey;
			}
		}
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

	/**
	 * Try to find a realm name or something similar in the token.
	 *
	 * This is useful when the token is not encrypted and API has multiple realms.
	 * Instead of trying to verify the token with all keys, we can try to find the key !
	 *
	 * @param token
	 * @protected
	 */
	protected tryToGetKeyLoaderFromToken(
		token: string,
	): KeyLoaderHolder | undefined {
		try {
			const iss = JSON.parse(atob(token.split(".")[1])).iss;
			if (typeof iss === "string") {
				const realmAsKeyName = iss.split("/realms/")[1];
				return this.keystore.find((it) => it.name === realmAsKeyName);
			}
		} catch (_error) {
			// ignore
		}
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
	issuedAt?: boolean;
	protectedHeader?: JWTHeaderParameters;
	expiresIn?: number;
}

export interface ExtendedJWTPayload extends JWTPayload {
	name?: string;
	roles?: string[];
	// keycloak specific
	realm_access?: { roles: string[] };
}

export interface JwtParseResult {
	keyName: string;
	result: JWTVerifyResult<ExtendedJWTPayload>;
}
