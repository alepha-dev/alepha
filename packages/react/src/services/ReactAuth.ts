import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import { HttpClient } from "@alepha/server";
import { RedirectionError } from "../errors/RedirectionError.ts";
import { ReactBrowserProvider } from "../providers/ReactBrowserProvider.ts";

export class ReactAuth {
	alepha = $inject(Alepha);
	log = $logger();
	client = $inject(HttpClient);
	slugs = {
		login: "/api/_oauth/login",
		logout: "/api/_oauth/logout",
	};

	start = $hook({
		name: "start",
		handler: async () => {
			this.client.on("onError", (err) => {
				if (err.status === 401) {
					this.login();
				}
			});
		},
	});

	login = (provider?: string) => {
		if (this.alepha.isBrowser()) {
			const browser = this.alepha.get(ReactBrowserProvider);
			const redirect = browser.transitioning
				? window.location.origin + browser.transitioning.to
				: window.location.href;

			window.location.href = `${this.slugs.login}?redirect=${redirect}`;

			if (browser.transitioning) {
				throw new RedirectionError(browser.state.pathname);
			}

			return;
		}

		throw new RedirectionError(this.slugs.login);
	};

	logout = () => {
		window.location.href = `${this.slugs.logout}?redirect=${encodeURIComponent(window.location.origin)}`;
	};
}
