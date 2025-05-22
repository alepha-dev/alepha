import { type Async, KIND, OPTIONS, __descriptor } from "@alepha/core";

const KEY = "AUTH";

export type AccessToken = string;

export interface AuthDescriptorOptions {
	name?: string;
	oidc?: {
		issuer: string;
		clientId: string;
		clientSecret?: string;
		redirectUri?: string;
	};
	fallback?: () => Async<AccessToken>;
}

export interface AuthDescriptor {
	[KIND]: typeof KEY;
	[OPTIONS]: AuthDescriptorOptions;
	jwks: () => string;
}

export const $auth = (options: AuthDescriptorOptions): AuthDescriptor => {
	__descriptor(KEY);
	return {
		[KIND]: KEY,
		[OPTIONS]: options,
		jwks: () => {
			return options.oidc?.issuer ?? "";
		},
	};
};

$auth[KIND] = KEY;
