export class CookieManager {
	constructor(header = "") {
		if (header) {
			this.fromHeader(header);
		}
	}

	public readonly req: Record<string, string> = {};
	public readonly res: Record<string, Cookie | null> = {};

	/**
	 * Import the cookies from a header string.
	 *
	 * @param header - The header string.
	 */
	protected fromHeader(header: string) {
		const parts = header.split(";");
		for (const part of parts) {
			const [key, value] = part.split("=");
			if (!key || !value) {
				continue;
			}

			this.req[key.trim()] = value.trim();
		}
	}

	/**
	 * Export the cookies to a header string.
	 *
	 * @returns An array of strings.
	 */
	public toHeader(): string[] {
		const headers = [];

		for (const [name, cookie] of Object.entries(this.res)) {
			const parts: string[] = [];

			// If the cookie is null, we need to delete it
			if (cookie == null) {
				parts.push(`${name}=; Path=/; Max-Age=0`);
				headers.push(parts.join("; "));
				continue;
			}

			if (!cookie.value) {
				continue;
			}

			parts.push(`${name}=${cookie.value}`);

			if (cookie.path) {
				parts.push(`Path=${cookie.path}`);
			}
			if (cookie.maxAge) {
				parts.push(`Max-Age=${cookie.maxAge}`);
			}
			if (cookie.secure) {
				parts.push("Secure");
			}
			if (cookie.httpOnly) {
				parts.push("HttpOnly");
			}
			if (cookie.sameSite) {
				parts.push(`SameSite=${cookie.sameSite}`);
			}
			if (cookie.domain) {
				parts.push(`Domain=${cookie.domain}`);
			}

			headers.push(parts.join("; "));
		}

		return headers;
	}
}

export interface Cookie {
	value: string;
	path?: string;
	maxAge?: number;
	secure?: boolean;
	httpOnly?: boolean;
	sameSite?: "strict" | "lax" | "none";
	domain?: string;
}
