import { type Async, createDescriptor, Descriptor, KIND } from "@alepha/core";
import type { UserProfile } from "../providers/ReactAuthProvider.ts";
import type { Tokens } from "../schemas/tokensSchema.ts";

export const $auth = (options: AuthDescriptorOptions): AuthDescriptor => {
	return createDescriptor(AuthDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export type AuthDescriptorOptions = {
	disabled?: boolean;
	name?: string;
	fallback?: () => Async<AccessToken>;
	profile?: (raw: Record<string, any>) => Async<UserProfile>;
} & (
	| {
			oidc: OidcOptions;
	  }
	| {
			oauth: OAuthOptions;
	  }
	| {}
);

export interface OidcOptions {
	issuer: string;
	clientId: string;
	clientSecret?: string;
	redirectUri?: string;
	useIdToken?: boolean;
	logoutUri?: string;
	scope?: string;
}

export interface OAuthOptions {
	clientId: string;
	clientSecret?: string;
	redirectUri?: string;
	scope?: string;
	authorization: string;
	token: string;
	user: (tokens: Tokens) => Async<UserProfile>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class AuthDescriptor extends Descriptor<AuthDescriptorOptions> {
	public get name() {
		return this.options.name ?? this.config.propertyKey;
	}

	public jwks(): string {
		throw new Error("Method 'jwks' is not implemented in AuthDescriptor.");
	}
}

$auth[KIND] = AuthDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export type AccessToken = string;
