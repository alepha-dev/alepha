import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { ReactBrowserProvider, Redirection } from "@alepha/react";
import type { UserAccountToken } from "alepha/security";
import { HttpClient } from "alepha/server";
import { tokenResponseSchema } from "../schemas/tokenResponseSchema.ts";
import type { Tokens } from "../schemas/tokensSchema.ts";
import { userinfoResponseSchema } from "../schemas/userinfoResponseSchema.ts";

/**
 * Browser, SSR friendly, service to handle authentication.
 */
export class ReactAuth {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly httpClient = $inject(HttpClient);

  static path = {
    login: "/oauth/login",
    callback: "/oauth/callback",
    logout: "/oauth/logout",
    token: "/_auth/token",
    refresh: "/_auth/refresh",
    userinfo: "/_auth/userinfo",
  };

  protected readonly onBeginTransition = $hook({
    on: "react:transition:begin",
    handler: async (event) => {
      if (this.alepha.isBrowser()) {
        Object.defineProperty(event.state, "user", {
          get: () => this.user,
        });
      }
    },
  });

  protected readonly onFetchRequest = $hook({
    on: "client:onRequest",
    handler: async ({ request }) => {
      if (this.alepha.isBrowser() && this.user) {
        // ensure cookies are sent with requests and refresh-able
        request.credentials ??= "include";
      }
    },
  });

  /**
   * Get the current authenticated user.
   *
   * Alias for `alepha.state.get("user")`
   */
  public get user(): UserAccountToken | undefined {
    return this.alepha.state.get("alepha.server.request.user");
  }

  public async ping() {
    const { data } = await this.httpClient.fetch(ReactAuth.path.userinfo, {
      schema: { response: userinfoResponseSchema },
    });

    this.alepha.state.set("alepha.server.request.apiLinks", data.api);
    this.alepha.state.set("alepha.server.request.user", data.user);

    return data.user;
  }

  public async login(
    provider: string,
    options: {
      hostname?: string;
      username?: string;
      password?: string;
      redirect?: string;
      [extra: string]: any;
    },
  ): Promise<Tokens> {
    if (options.username || options.password) {
      const { data } = await this.httpClient.fetch(
        `${options.hostname || ""}${ReactAuth.path.token}?provider=${provider}`,
        {
          method: "POST",
          body: JSON.stringify({
            username: options.username,
            password: options.password,
            ...options,
          }),
          schema: { response: tokenResponseSchema },
        },
      );

      this.alepha.state.set("alepha.server.request.apiLinks", data.api);
      this.alepha.state.set("alepha.server.request.user", data.user);

      return data;
    }

    if (this.alepha.isBrowser()) {
      const browser = this.alepha.inject(ReactBrowserProvider);
      const redirect =
        options.redirect ||
        (browser.transitioning
          ? window.location.origin + browser.transitioning.to
          : window.location.href);

      const href = `${window.location.origin}${ReactAuth.path.login}?provider=${provider}&redirect_uri=${encodeURIComponent(redirect)}`;

      if (browser.transitioning) {
        throw new Redirection(href);
      } else {
        window.location.href = href;
        return {} as Tokens;
      }
    }

    throw new Redirection(
      `${ReactAuth.path.login}?provider=${provider}&redirect_uri=${options.redirect || "/"}`,
    );
  }

  public logout() {
    window.location.href = `${ReactAuth.path.logout}?post_logout_redirect_uri=${encodeURIComponent(window.location.origin)}`;
  }
}
