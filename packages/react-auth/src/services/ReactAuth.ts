import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import { ReactBrowserProvider, Redirection } from "@alepha/react";
import type { UserAccountToken } from "@alepha/security";
import { $client, LinkProvider } from "@alepha/server-links";
import type { ReactAuthProvider } from "../providers/ReactAuthProvider.ts";
import type { Tokens } from "../schemas/tokensSchema.ts";

export class ReactAuth {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly auth = $client<ReactAuthProvider>();
	protected readonly linkProvider = $inject(LinkProvider);

	static path = {
		login: "/oauth/login",
		callback: "/oauth/callback",
		logout: "/oauth/logout",
		token: "/_auth/token",
		refresh: "/_auth/refresh",
		userinfo: "/_auth/userinfo",
	};

	protected readonly onFetchRequest = $hook({
		on: "client:onRequest",
		handler: async (event) => {
			if (this.alepha.isBrowser() && this.user) {
				// ensure cookies are sent with requests and refresh-able
				event.request.credentials ??= "include";
			}
		},
	});

	public readonly onRender = $hook({
		on: "react:transition:begin",
		handler: async ({ context }) => {
			if (this.alepha.isBrowser() && this.user) {
				context.user = this.user;
			}
		},
	});

	public get user(): UserAccountToken | undefined {
		return this.alepha.state("user");
	}

	public async ping() {
		const user = await this.auth.userinfo();
		this.alepha.state("user", user);
		return user;
	}

	public async login(
		provider: string,
		options: {
			username?: string;
			password?: string;
			redirect?: string;
			[extra: string]: any;
		},
	): Promise<Tokens> {
		if (options.username && options.password) {
			const data = await this.auth.token({
				query: {
					provider,
				},
				body: {
					username: options.username,
					password: options.password,
					...options,
				},
			});

			if (this.alepha.isBrowser()) {
				for (const link of data.links.links) {
					this.linkProvider.pushLink({
						...link,
						prefix: data.links.prefix,
					});
				}
			}

			this.alepha.state("user", data.user);

			return data;
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

			return {} as Tokens;
		}

		throw new Redirection(ReactAuth.path.login);
	}

	public logout() {
		window.location.href = `${ReactAuth.path.logout}?post_logout_redirect_uri=${encodeURIComponent(window.location.origin)}`;
	}
}
