import { randomUUID } from "node:crypto";
import { $cursor } from "@alepha/core";
import { JwtProvider } from "../providers/JwtProvider.ts";

/**
 * Create a service account that can be used to authenticate with a OAUTH2 server.
 *
 * @param options
 */
export const $serviceAccount = (
	options: ServiceAccountDescriptorOptions,
): ServiceAccountDescriptor => {
	if ("oauth2" in options) {
		const { url, clientId, clientSecret } = options.oauth2;
		const store: {
			response?: AccessTokenResponse;
		} = {};

		const token = async () => {
			if (store.response) {
				const { access_token, expires_in, at } = store.response;
				const now = Date.now();
				const expires = at + expires_in * 1000;

				if (expires - 5000 > now) {
					return access_token;
				}
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

			store.response = {
				...json,
				at: Date.now(),
			};

			return json.access_token;
		};

		return {
			options,
			store,
			token,
			fetch: async (url, options) => {
				const headers = new Headers(options?.headers);

				headers.set("Authorization", `Bearer ${await token()}`);

				return fetch(url, {
					...options,
					headers,
				});
			},
		};
	}

	const { secret } = options.jwt;
	const { context } = $cursor();

	const jwt = context.get(JwtProvider);
	const sub = randomUUID();
	const roles = options.jwt.roles ?? [];

	//TODO: add jwt options (expiresIn, audience, issuer, etc.)

	jwt.setKeyLoader(secret, secret);

	const token = async () => {
		return context.get(JwtProvider).create({ sub, roles }, secret);
	};

	return {
		options,
		store: {},
		token,
		fetch: async (url, options) => {
			const headers = new Headers(options?.headers);

			headers.set("Authorization", `Bearer ${await token()}`);

			return fetch(url, {
				...options,
				headers,
			});
		},
	};
};

export type ServiceAccountDescriptorOptions =
	| {
			oauth2: {
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

				/**
				 * Scopes to request.
				 */
				scope?: string;
			};
	  }
	| {
			jwt: {
				secret: string;
				roles?: string[];
			};
	  };

export interface ServiceAccountDescriptor {
	options: ServiceAccountDescriptorOptions;
	store: ServiceAccountStore;
	token: () => Promise<string>;
	fetch(url: string, options?: RequestInit): Promise<Response>;
}

export interface AccessTokenResponse {
	access_token: string;
	expires_in: number;
	at: number;
}

export interface ServiceAccountStore {
	response?: AccessTokenResponse;
}
