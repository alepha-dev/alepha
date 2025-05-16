import { KIND, __descriptor, OPTIONS } from "@alepha/core";

const KEY = "AUTH";

export interface AuthDescriptorOptions {
	name?: string;
	oidc?: {
		issuer: string;
		clientId: string;
		clientSecret?: string;
		redirectUri?: string;
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
			return options.oidc?.issuer ?? "";
		},
	};
};

$auth[KIND] = KEY;
