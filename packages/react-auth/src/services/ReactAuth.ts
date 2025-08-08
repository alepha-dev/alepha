import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import { ReactBrowserProvider, Redirection } from "@alepha/react";
import type { UserAccountToken } from "@alepha/security";
import { HttpClient } from "@alepha/server";
import { $client, LinkProvider } from "@alepha/server-links";
import type { ReactAuthProvider } from "../providers/ReactAuthProvider.ts";

export class ReactAuth {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly auth = $client<ReactAuthProvider>();
	protected readonly client = $inject(HttpClient);
	protected readonly linkProvider = $inject(LinkProvider);

	static path = {
		login: "/oauth/login",
		callback: "/oauth/callback",
		logout: "/oauth/logout",
		token: "/oauth/token",
		userinfo: "/oauth/userinfo",
	};

	public readonly onRender = $hook({
		on: "react:transition:begin",
		handler: async () => {
			//if (!this.alepha.state("user")) {
			//	this.alepha.state("user", await this.auth.userinfo());
			//}
		},
	});

	public get user(): UserAccountToken | undefined {
		return this.alepha.state("user");
	}

	public async login(
		provider: string,
		options: {
			username?: string;
			password?: string;
			redirect?: string;
			[extra: string]: any;
		},
	) {
		if (options.username) {
			const { data } = await this.client.fetch<any>(
				`${ReactAuth.path.token}?provider=${provider}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					credentials: "include",
					body: JSON.stringify({
						username: options.username,
						password: options.password,
						...options,
					}),
				},
			);
			for (const link of data.links.links) {
				this.linkProvider.pushLink({
					...link,
					prefix: link.prefix,
				});
			}
			this.alepha.state("user", data.user);
			return;
		}

		if (this.alepha.isBrowser()) {
			const browser = this.alepha.inject(ReactBrowserProvider);
			const redirect =
				options.redirect ||
				(browser.transitioning
					? window.location.origin + browser.transitioning.to
					: window.location.href);

			window.location.href = `${ReactAuth.path.login}?provider=${provider}&redirect_uri=${redirect}`;

			if (browser.transitioning) {
				throw new Redirection(browser.state.pathname);
			}

			return;
		}

		throw new Redirection(ReactAuth.path.login);
	}

	public logout() {
		window.location.href = `${ReactAuth.path.logout}?post_logout_redirect_uri=${encodeURIComponent(window.location.origin)}`;
	}
}
