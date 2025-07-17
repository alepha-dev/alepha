import { $hook, $inject, Alepha, type HookDescriptor } from "@alepha/core";

type CspDirective = string | string[];

export interface CspOptions {
	directives: {
		"default-src"?: CspDirective;
		"script-src"?: CspDirective;
		"style-src"?: CspDirective;
		"img-src"?: CspDirective;
		"connect-src"?: CspDirective;
		"font-src"?: CspDirective;
		"object-src"?: CspDirective;
		"media-src"?: CspDirective;
		"frame-src"?: CspDirective;
		sandbox?: CspDirective | boolean;
		"report-uri"?: string;
		"child-src"?: CspDirective;
		"form-action"?: CspDirective;
		"frame-ancestors"?: CspDirective;
		"plugin-types"?: CspDirective;
		"base-uri"?: CspDirective;
		[key: string]: CspDirective | undefined | boolean;
	};
}

export interface HstsOptions {
	maxAge?: number;
	includeSubDomains?: boolean;
	preload?: boolean;
}

export interface HelmetOptions {
	isSecure?: boolean;
	strictTransportSecurity?: HstsOptions | false;
	xContentTypeOptions?: false;
	xFrameOptions?: "DENY" | "SAMEORIGIN" | false;
	xXssProtection?: false;
	contentSecurityPolicy?: CspOptions | false;
	referrerPolicy?:
		| "no-referrer"
		| "no-referrer-when-downgrade"
		| "origin"
		| "origin-when-cross-origin"
		| "same-origin"
		| "strict-origin"
		| "strict-origin-when-cross-origin"
		| "unsafe-url"
		| false;
}

/**
 * Provides a configurable way to apply essential HTTP security headers
 * to every server response, without external dependencies.
 */
export class ServerHelmetProvider {
	protected readonly alepha = $inject(Alepha);

	/**
	 * The configuration options. These can be overridden during
	 * the application's configuration phase using `alepha.configure()`.
	 */
	public options: HelmetOptions = {
		strictTransportSecurity: { maxAge: 15552000, includeSubDomains: true }, // 180 days
		xFrameOptions: "SAMEORIGIN",
		xXssProtection: false, // Modern browsers use CSP, this can cause issues. Defaulting to off.
		contentSecurityPolicy: false, // CSP is powerful but requires careful configuration. Opt-in only.
		referrerPolicy: "strict-origin-when-cross-origin",
	};

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {};
		const {
			strictTransportSecurity: hsts,
			xContentTypeOptions,
			xFrameOptions,
			xXssProtection,
			contentSecurityPolicy: csp,
			referrerPolicy,
		} = this.options;

		// Strict-Transport-Security
		if (hsts) {
			let value = `max-age=${hsts.maxAge ?? 15552000}`;
			if (hsts.includeSubDomains) value += "; includeSubDomains";
			if (hsts.preload) value += "; preload";
			headers["strict-transport-security"] = value;
		}

		// X-Content-Type-Options
		if (xContentTypeOptions !== false) {
			headers["x-content-type-options"] = "nosniff";
		}

		// X-Frame-Options
		if (xFrameOptions) {
			headers["x-frame-options"] = xFrameOptions;
		}

		// X-XSS-Protection
		if (xXssProtection !== false) {
			headers["x-xss-protection"] = "1; mode=block";
		}

		// Referrer-Policy
		if (referrerPolicy) {
			headers["referrer-policy"] = referrerPolicy;
		}

		// Content-Security-Policy
		if (csp) {
			headers["content-security-policy"] = Object.entries(csp.directives)
				.map(([key, value]) => {
					const kebabKey = key.replace(
						/[A-Z]/g,
						(letter) => `-${letter.toLowerCase()}`,
					);
					if (Array.isArray(value)) {
						return `${kebabKey} ${value.join(" ")}`;
					}
					if (typeof value === "boolean" && value) {
						return kebabKey;
					}
					return `${kebabKey} ${value}`;
				})
				.join("; ");
		}

		return headers;
	}

	protected readonly onResponse: HookDescriptor<"server:onResponse"> = $hook({
		on: "server:onResponse",
		priority: "first",
		handler: ({ response }) => {
			// this check is important. Only add HSTS on HTTPS requests.
			const isSecure =
				response.headers["x-forwarded-proto"] === "https" ||
				this.options.isSecure ||
				this.alepha.isProduction();

			const headersToSet = this.buildHeaders();

			for (const [key, value] of Object.entries(headersToSet)) {
				if (key === "strict-transport-security" && !isSecure) {
					continue;
				}
				// don't overwrite headers if they are already set
				if (!response.headers[key]) {
					response.headers[key] = value;
				}
			}
		},
	});
}
