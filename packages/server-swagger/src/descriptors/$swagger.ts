import { KIND, __descriptor, OPTIONS } from "@alepha/core";
import type { OpenAPIV3 } from "openapi-types";

export interface SwaggerDescriptorOptions {
	info: OpenAPIV3.InfoObject;

	/**
	 * @default: "/docs"
	 */
	prefix?: string;

	/**
	 * If true, docs will be disabled.
	 */
	disabled?: boolean;

	excludeTags?: string[];

	ui?: boolean | SwaggerUiOptions;

	rewrite?: (doc: OpenAPIV3.Document) => void;
}

export interface SwaggerUiOptions {
	initOAuth?: {
		/**
		 * Default clientId.
		 */
		clientId?: string;

		/**
		 * realm query parameter (for oauth1) added to authorizationUrl and tokenUrl.
		 */
		realm?: string;

		/**
		 * application name, displayed in authorization popup.
		 */
		appName?: string;

		/**
		 * scope separator for passing scopes, encoded before calling, default
		 * value is a space (encoded value %20).
		 *
		 * @default ' '
		 */
		scopeSeparator?: string;

		/**
		 * string array or scope separator (i.e. space) separated string of
		 * initially selected oauth scopes
		 *
		 * @default []
		 */
		scopes?: string | string[];

		/**
		 * Additional query parameters added to authorizationUrl and tokenUrl.
		 * MUST be an object
		 */
		additionalQueryStringParams?: { [key: string]: any };

		/**
		 * Only activated for the accessCode flow. During the authorization_code
		 * request to the tokenUrl, pass the Client Password using the HTTP Basic
		 * Authentication scheme (Authorization header with Basic
		 * base64encode(client_id + client_secret)).
		 *
		 * @default false
		 */
		useBasicAuthenticationWithAccessCodeGrant?: boolean;

		/**
		 * Only applies to Authorization Code flows. Proof Key for Code Exchange
		 * brings enhanced security for OAuth public clients.
		 *
		 * @default false
		 */
		usePkceWithAuthorizationCodeGrant?: boolean;
	};
}

export interface SwaggerDescriptor {
	[KIND]: "SWAGGER";
	[OPTIONS]: SwaggerDescriptorOptions;
	json(): OpenAPIV3.Document;
}

export const $swagger = (
	options: SwaggerDescriptorOptions,
): SwaggerDescriptor => {
	__descriptor("SWAGGER");
	return {
		[KIND]: "SWAGGER",
		[OPTIONS]: options,
		json() {
			return {
				openapi: "3.0.0",
				info: options.info,
				paths: {},
			};
		},
	};
};

$swagger[KIND] = "SWAGGER";
