import {
	$inject,
	AlephaError,
	type Async,
	createDescriptor,
	Descriptor,
	KIND,
} from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import {
	type AccessTokenResponse,
	type RealmDescriptor,
	SecurityProvider,
	type UserAccountInfo,
} from "@alepha/security";
import {
	allowInsecureRequests,
	Configuration,
	discovery,
	refreshTokenGrant,
} from "openid-client";
import type { OAuth2UserInfo } from "../providers/ReactAuthProvider.ts";
import type { Tokens } from "../schemas/tokensSchema.ts";

export const $auth = (options: AuthDescriptorOptions): AuthDescriptor => {
	return createDescriptor(AuthDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export type AuthDescriptorOptions = {
	/**
	 * Name of the identity provider.
	 * If not provided, it will be derived from the property key.
	 */
	name?: string;

	/**
	 * If true, auth provider will be skipped.
	 */
	disabled?: boolean;
} & (AuthExternal | AuthInternal);

/**
 * When you let an external service handle authentication. (e.g. Keycloak, Auth0, etc.)
 */
export type AuthExternal = {
	/**
	 * Only OIDC is supported for external authentication.
	 */
	oidc: OidcOptions;

	/**
	 * For anonymous access, this will expect a service account access token.
	 *
	 * ```ts
	 * class App {
	 *   anonymous = $serviceAccount(...);
	 *   auth = $auth({
	 *     // ... config ...
	 *     fallback: this.anonymous,
	 *   })
	 * }
	 * ```
	 */
	fallback?: () => Async<AccessToken>;
};

/**
 * When using your own authentication system, e.g. using a database to store user accounts.
 * This is usually used with a custom login form.
 *
 * This relies on the `realm`, which is used to create/verify the access token.
 */
export type AuthInternal = {
	realm: RealmDescriptor;
} & (
	| {
			/**
			 * The common username/password authentication.
			 *
			 * - It uses the OAuth2 Client Credentials flow to obtain an access token.
			 *
			 * This is usually used with a custom login form on your website or mobile app.
			 */
			credentials: CredentialsOptions;
	  }
	| {
			/**
			 * OAuth2 authentication. Delegates authentication to an OAuth2 provider. (e.g. Google, GitHub, etc.)
			 *
			 * - It uses the OAuth2 Authorization Code flow to obtain an access token and user information.
			 *
			 * This is usually used with a login button that redirects to the OAuth2 provider.
			 */
			oauth: OAuth2Options;
	  }
	| {
			/**
			 * Like OAuth2, but uses OIDC (OpenID Connect) for authentication and user information retrieval.
			 * OIDC is an identity layer on top of OAuth2, providing user authentication and profile information.
			 *
			 * - It uses the OAuth2 Authorization Code flow to obtain an access token and user information.
			 * - PCKE (Proof Key for Code Exchange) is recommended for security.
			 *
			 * This is usually used with a login button that redirects to the OIDC provider.
			 */
			oidc: OidcOptions;
	  }
);

export type CredentialsOptions = {
	user: (entry: {
		username: string;
		password: string;
	}) => Async<UserAccountInfo>;
};

export interface OidcOptions {
	/**
	 * URL of the OIDC issuer.
	 */
	issuer: string;

	/**
	 * Client ID for the OIDC client.
	 */
	clientId: string;

	/**
	 * Client secret for the OIDC client.
	 * Optional if PKCE (Proof Key for Code Exchange) is used.
	 */
	clientSecret?: string;

	/**
	 * Redirect URI for the OIDC client.
	 * This is where the user will be redirected after authentication.
	 */
	redirectUri?: string;

	/**
	 * For external auth providers only.
	 * Take the ID token instead of the access token for validation.
	 */
	useIdToken?: boolean;

	/**
	 * URI to redirect the user after logout.
	 */
	logoutUri?: string;

	/**
	 * Optional scope for the OIDC client.
	 * @default "openid profile email".
	 */
	scope?: string;

	user?: (tokens: {
		id_token?: string;
		access_token: string;
		expires_in?: number;
		scope?: string;
		user: OAuth2UserInfo;
	}) => Async<UserAccountInfo>;
}

export interface OAuth2Options {
	/**
	 * URL of the OAuth2 authorization endpoint.
	 */
	clientId: string;

	/**
	 * Client secret for the OAuth2 client.
	 */
	clientSecret: string;

	/**
	 * URL of the OAuth2 authorization endpoint.
	 */
	authorization: string;

	/**
	 * URL of the OAuth2 token endpoint.
	 */
	token: string;

	/**
	 * Function to retrieve user profile information from the OAuth2 tokens.
	 */
	user: (tokens: Tokens) => Async<UserAccountInfo>;

	/**
	 * URL of the OAuth2 authorization endpoint.
	 */
	redirectUri?: string;

	/**
	 * URL of the OAuth2 authorization endpoint.
	 */
	scope?: string;
}

// ---------------------------------------------------------------------------------------------------------------------

export class AuthDescriptor extends Descriptor<AuthDescriptorOptions> {
	protected readonly securityProvider = $inject(SecurityProvider);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);

	public oauth?: Configuration;

	public get name() {
		return this.options.name ?? this.config.propertyKey;
	}

	public get jwks_uri(): string {
		const jwks = this.oauth?.serverMetadata().jwks_uri;
		if (!jwks) {
			throw new AlephaError("No JWKS URI available for the auth provider");
		}
		return jwks;
	}

	public get scope(): string | undefined {
		if ("oauth" in this.options) {
			return this.options.oauth.scope;
		}
		if ("oidc" in this.options) {
			return this.options.oidc.scope || "openid profile email";
		}
		throw new AlephaError(
			"No OAuth2 or OIDC configuration available for the auth provider",
		);
	}

	public get redirect_uri() {
		if ("oauth" in this.options) {
			return this.options.oauth.redirectUri;
		}
		if ("oidc" in this.options) {
			return this.options.oidc.redirectUri;
		}
		throw new AlephaError(
			"No OAuth2 or OIDC configuration available for the auth provider",
		);
	}

	/**
	 * Refreshes the access token using the refresh token.
	 */
	public async refresh(tokens: Tokens): Promise<AccessTokenResponse> {
		if (!tokens.refresh_token) {
			throw new AlephaError("No refresh token available for the auth provider");
		}

		if ("realm" in this.options) {
			// TODO: hook for session refresh

			const user = await this.securityProvider.createUserFromToken(
				tokens.access_token,
				{
					realm: this.options.realm.name,
					verify: {
						currentDate: new Date(0), // don't verify expiration, it's expected to be expired...
					},
				},
			);

			return this.options.realm.createToken(user, tokens.refresh_token);
		} else if (this.oauth) {
			return {
				...(await refreshTokenGrant(this.oauth, tokens.refresh_token)),
				issued_at: this.dateTimeProvider.now().unix(),
			};
		}

		throw new AlephaError(
			"No realm or OAuth2 configuration available for the auth provider",
		);
	}

	/**
	 * Extracts user information from the access token.
	 * This is used to create a user account from the access token.
	 */
	public async user(tokens: Tokens): Promise<UserAccountInfo> {
		if ("oauth" in this.options) {
			return this.options.oauth.user(tokens);
		}

		if ("oidc" in this.options) {
			const payload = this.getUserFromIdToken(tokens.id_token || "");

			if (this.options.oidc.user) {
				return this.options.oidc.user({
					...tokens,
					user: payload,
				});
			}

			return this.securityProvider.createUserFromPayload(payload);
		}

		throw new AlephaError(
			"Authentication is not supported for user extraction from tokens",
		);
	}

	protected getUserFromIdToken(idToken: string): OAuth2UserInfo {
		try {
			return JSON.parse(
				Buffer.from(idToken.split(".")[1], "base64").toString("utf8"),
			) as OAuth2UserInfo;
		} catch (error) {
			throw new AlephaError("Failed to parse ID Token payload", {
				cause: error,
			});
		}
	}

	public async prepare() {
		const addons: Array<(config: Configuration) => void> = [];

		if (!this.alepha.isProduction()) {
			addons.push(allowInsecureRequests);
		}

		if ("oidc" in this.options) {
			const { oidc } = this.options;

			this.oauth = await discovery(
				new URL(oidc.issuer),
				oidc.clientId,
				{
					client_secret: oidc.clientSecret,
				},
				undefined,
				{
					execute: addons,
				},
			);
		}

		if ("oauth" in this.options) {
			const { oauth } = this.options;

			this.oauth = new Configuration(
				{
					authorization_endpoint: oauth.authorization,
					token_endpoint: oauth.token,
					issuer: oauth.authorization, // use authorization URL as a pseudo-issuer?
					// we don't need all of these endpoints
					jwks_uri: undefined,
					end_session_endpoint: undefined,
				},
				oauth.clientId,
				{
					client_secret: oauth.clientSecret,
				},
			);
		}
	}
}

$auth[KIND] = AuthDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export type AccessToken = string | { token: () => Async<string> };
