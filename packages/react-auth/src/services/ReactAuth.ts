import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import { ReactBrowserProvider, RedirectionError } from "@alepha/react";
import type { UserAccountToken } from "@alepha/security";
import { HttpClient } from "@alepha/server";

export class ReactAuth {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly client = $inject(HttpClient);

	static path = {
		login: "/oauth/login",
		callback: "/oauth/callback",
		logout: "/oauth/logout",
	};

	public readonly onRender = $hook({
		on: "react:transition:begin",
		handler: async ({ context }) => {
			context.user = this.getUserFromCookies();
		},
	});

	public get user(): UserAccountToken | undefined {
		return this.getUserFromCookies();
	}

	protected getUserFromCookies(): UserAccountToken | undefined {
		if (this.alepha.isBrowser()) {
			const browser = this.alepha.get(ReactBrowserProvider);
			const cookies = browser.document.cookie.split("; ");
			const userCookie = cookies.find((cookie) => cookie.startsWith("user="));

			try {
				if (userCookie) {
					return JSON.parse(decodeURIComponent(userCookie.split("=")[1]));
				}
			} catch (error) {
				this.log.warn(error, "Failed to parse user cookie");
			}
		}

		return undefined;
	}

	public login() {
		if (this.alepha.isBrowser()) {
			const browser = this.alepha.get(ReactBrowserProvider);
			const redirect = browser.transitioning
				? window.location.origin + browser.transitioning.to
				: window.location.href;

			window.location.href = `${ReactAuth.path.login}?redirect=${redirect}`;

			if (browser.transitioning) {
				throw new RedirectionError(browser.state.pathname);
			}

			return;
		}

		throw new RedirectionError(ReactAuth.path.login);
	}

	public logout() {
		window.location.href = `${ReactAuth.path.logout}?redirect=${encodeURIComponent(window.location.origin)}`;
	}
}
