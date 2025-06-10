import {
	type Async,
	KIND,
	NotImplementedError,
	OPTIONS,
	__descriptor,
} from "@alepha/core";

const KEY = "AUTH";

export type AccessToken = string;

export interface AuthDescriptorOptions {
	name?: string;
	fallback?: () => Async<AccessToken>;
	oidc?: {
		issuer: string;
		clientId: string;
		clientSecret?: string;
		redirectUri?: string;
		useIdToken?: boolean;
	};
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
			throw new NotImplementedError(KEY);
		},
	};
};

$auth[KIND] = KEY;
