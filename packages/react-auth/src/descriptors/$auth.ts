import { KIND, __descriptor } from "@alepha/core";

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
	options: AuthDescriptorOptions;
	jwks: () => string;
}

export const $auth = (options: AuthDescriptorOptions): AuthDescriptor => {
	__descriptor(KEY);
	return {
		[KIND]: KEY,
		options,
		jwks: () => {
			return options.oidc?.issuer ?? "";
		},
	};
};

$auth[KIND] = KEY;
