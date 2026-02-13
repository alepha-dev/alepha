import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { ReactBrowserProvider, Redirection } from "alepha/react/router";
import { currentUserAtom, type UserAccountToken } from "alepha/security";
import { HttpClient } from "alepha/server";
import {
  alephaServerAuthRoutes,
  type Tokens,
  tokenResponseSchema,
  userinfoResponseSchema,
} from "alepha/server/auth";
import { LinkProvider } from "alepha/server/links";

/**
 * Browser, SSR friendly, service to handle authentication.
 */
export class ReactAuth {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly httpClient = $inject(HttpClient);
  protected readonly linkProvider = $inject(LinkProvider);

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
    return this.alepha.store.get(currentUserAtom) as
      | UserAccountToken
      | undefined;
  }

  public async ping() {
    const { data } = await this.httpClient.fetch(
      alephaServerAuthRoutes.userinfo,
      {
        schema: { response: userinfoResponseSchema },
      },
    );

    this.alepha.store.set("alepha.server.request.apiLinks", data.api);
    this.alepha.store.set(currentUserAtom, data.user);

    return data.user;
  }

  public can(action: string): boolean {
    if (!this.user) {
      return false;
    }

    return this.linkProvider.can(action);
  }

  public async login(
    provider: string,
    options: {
      hostname?: string;
      username?: string;
      password?: string;
      redirect?: string;
      realm?: string;
      [extra: string]: any;
    },
  ): Promise<Tokens> {
    const realmParam = options.realm
      ? `&realm=${encodeURIComponent(options.realm)}`
      : "";

    if (options.username || options.password) {
      const { data } = await this.httpClient.fetch(
        `${options.hostname || ""}${alephaServerAuthRoutes.token}?provider=${provider}${realmParam}`,
        {
          method: "POST",
          body: JSON.stringify({
            username: options.username,
            password: options.password,
          }),
          schema: { response: tokenResponseSchema },
        },
      );

      this.alepha.store.set("alepha.server.request.apiLinks", data.api);
      this.alepha.store.set(currentUserAtom, data.user);

      return data;
    }

    if (this.alepha.isBrowser()) {
      const browser = this.alepha.inject(ReactBrowserProvider);
      const redirect =
        options.redirect ||
        (browser.transitioning
          ? window.location.origin + browser.transitioning.to
          : window.location.href);

      const href = `${window.location.origin}${alephaServerAuthRoutes.login}?provider=${provider}${realmParam}&redirect_uri=${encodeURIComponent(redirect)}`;

      if (browser.transitioning) {
        throw new Redirection(href);
      } else {
        window.location.href = href;
        return {} as Tokens;
      }
    }

    throw new Redirection(
      `${alephaServerAuthRoutes.login}?provider=${provider}${realmParam}&redirect_uri=${options.redirect || "/"}`,
    );
  }

  public logout() {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `${alephaServerAuthRoutes.logout}?post_logout_redirect_uri=${encodeURIComponent(window.location.origin)}`;
    form.style.display = "none";
    document.body.appendChild(form);
    form.submit();
  }
}
