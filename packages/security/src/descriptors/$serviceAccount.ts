import { $cursor } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import type { UserAccount } from "../schemas/userAccountInfoSchema.ts";
import type { AccessTokenResponse, RealmDescriptor } from "./$realm.ts";

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
	const gracePeriod = options.gracePeriod ?? 30;

	const cacheToken = (response: Omit<AccessTokenResponse, "at">) => {
		store.cache = {
			...response,
			issued_at: dateTimeProvider.now().unix(),
		};
	};

	const getTokenFromCache = () => {
		if (store.cache) {
			const { access_token, expires_in, issued_at } = store.cache;
			if (!expires_in) {
				return access_token;
			}

			const now = dateTimeProvider.now().unix();
			const expires = issued_at + expires_in;

			if (expires - gracePeriod > now) {
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

	return {
		token: async () => {
			const tokenFromCache = getTokenFromCache();
			if (tokenFromCache) {
				return tokenFromCache;
			}

			const token = await options.realm.createToken(options.user);

			cacheToken({
				...token,
				issued_at: dateTimeProvider.now().unix(),
			});

			return token.access_token;
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
			realm: RealmDescriptor;
			user: UserAccount;
	  }
);

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

export interface ServiceAccountStore {
	response?: AccessTokenResponse;
}
