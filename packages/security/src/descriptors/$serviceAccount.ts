import { randomUUID } from "node:crypto";
import { $cursor } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { JwtProvider, type JwtSignOptions } from "../providers/JwtProvider.ts";

/**
 * Allow to get an access token for a service account.
 *
 * You have some options to configure the service account:
 * - a OAUTH2 URL using client credentials grant type
 * - a JWT secret shared between the services
 *
 * @example
 * ```ts
 * import { $serviceAccount } from "@alepha/security";
 *
 * class MyService {
 *   serviceAccount = $serviceAccount({
 *     oauth2: {
 *       url: "https://example.com/oauth2/token",
 *       clientId: "your-client-id",
 *       clientSecret: "your-client-secret",
 *     }
 *   });
 *
 *   async fetchData() {
 *     const token = await this.serviceAccount.token();
 *     // or
 *     const response = await this.serviceAccount.fetch("https://api.example.com/data");
 *   }
 * }
 * ```
 */
export const $serviceAccount = (
	options: ServiceAccountDescriptorOptions,
): ServiceAccountDescriptor => {
	const { context } = $cursor();
	const store: {
		cache?: AccessTokenResponse;
	} = {};
	const dateTimeProvider = context.inject(DateTimeProvider);
	const gracePeriod = options.gracePeriod ?? 30000;

	const cacheToken = (response: Omit<AccessTokenResponse, "at">) => {
		store.cache = {
			...response,
			at: dateTimeProvider.now().valueOf(),
		};
	};

	const getTokenFromCache = () => {
		if (store.cache) {
			const { access_token, expires_in, at } = store.cache;
			const now = dateTimeProvider.now().valueOf();
			const expires = at + expires_in * 1000;
			if (expires + gracePeriod > now) {
				return access_token;
			}
		}
	};

	if ("oauth2" in options) {
		const { url, clientId, clientSecret } = options.oauth2;

		const token = async () => {
			const tokenFromCache = getTokenFromCache();
			if (tokenFromCache) {
				return tokenFromCache;
			}

			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "client_credentials",
					client_id: clientId,
					client_secret: clientSecret,
				}),
			});

			const json = await response.json();

			if (!json.access_token || !json.expires_in) {
				throw new Error(
					`Failed to fetch access token: ${JSON.stringify(json)}`,
				);
			}

			cacheToken(json);

			return json.access_token;
		};

		return {
			token,
		};
	}

	const { secret, signOptions } = options.jwt;

	const jwt = context.inject(JwtProvider);
	const sub = randomUUID();
	const roles = options.jwt.roles ?? [];

	jwt.setKeyLoader(secret, secret);

	return {
		token: async () => {
			const tokenFromCache = getTokenFromCache();
			if (tokenFromCache) {
				return tokenFromCache;
			}

			const options = signOptions ?? {};

			options.expiresIn ??= 300; // default to 5 minutes

			const token = await jwt.create({ sub, roles }, secret, options);

			cacheToken({
				access_token: token,
				expires_in: options.expiresIn,
			});

			return token;
		},
	};
};

export type ServiceAccountDescriptorOptions = {
	gracePeriod?: number; // Grace period in milliseconds before token expiration
} & (
	| {
			oauth2: Oauth2ServiceAccountDescriptorOptions;
	  }
	| {
			jwt: JwtServiceAccountDescriptorOptions;
	  }
);

export interface JwtServiceAccountDescriptorOptions {
	secret: string;
	roles?: string[];
	signOptions?: JwtSignOptions;
}

export interface Oauth2ServiceAccountDescriptorOptions {
	/**
	 * Get Token URL.
	 */
	url: string;

	/**
	 * Client ID.
	 */
	clientId: string;

	/**
	 * Client Secret.
	 */
	clientSecret: string;
}

export interface ServiceAccountDescriptor {
	token: () => Promise<string>;
}

export interface AccessTokenResponse {
	access_token: string;
	expires_in: number;
	at: number;
}

export interface ServiceAccountStore {
	response?: AccessTokenResponse;
}
