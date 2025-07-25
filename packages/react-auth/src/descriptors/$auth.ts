import { type Async, createDescriptor, Descriptor, KIND } from "@alepha/core";

export const $auth = (options: AuthDescriptorOptions): AuthDescriptor => {
	return createDescriptor(AuthDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface AuthDescriptorOptions {
	name?: string;
	fallback?: () => Async<AccessToken>;
	oidc?: {
		issuer: string;
		clientId: string;
		clientSecret?: string;
		redirectUri?: string;
		useIdToken?: boolean;
		logoutUri?: string;
	};
}

// ---------------------------------------------------------------------------------------------------------------------

export class AuthDescriptor extends Descriptor<AuthDescriptorOptions> {
	public get name() {
		return this.options.name ?? this.config.propertyKey;
	}

	public jwks(): string {
		return "";
	}
}

$auth[KIND] = AuthDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export type AccessToken = string;
