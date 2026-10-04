import { $hook, $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { ReactBrowserProvider, Redirection } from "alepha/react/router";
import { currentUserAtom, type UserAccountToken } from "alepha/security";
import { HttpClient } from "alepha/server";
import {
  alephaServerAuthRoutes,
  mfaResendResponseSchema,
  type TokenResponse,
  type Tokens,
  tokenResponseSchema,
  userinfoResponseSchema,
} from "alepha/server/auth";
import { LinkProvider } from "alepha/server/links";

import { ReactAuthTransport } from "./ReactAuthTransport.ts";

/**
 * Browser, SSR friendly, service to handle authentication.
 */
export class ReactAuth {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly httpClient = $inject(HttpClient);
  protected readonly linkProvider = $inject(LinkProvider);
  protected readonly transport = $inject(ReactAuthTransport);

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
      if (this.alepha.isBrowser() && this.user && this.transport.cookies) {
        // ensure cookies are sent with requests and refresh-able. Never for a
        // transport without cookies: a cross-origin request asking for
        // credentials needs a CORS grant a Bearer API does not give.
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
      this.transport.url(alephaServerAuthRoutes.userinfo),
      {
        ...(await this.transport.request({ authenticated: true })),
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
        `${this.authUrl(alephaServerAuthRoutes.token, options.hostname)}?provider=${provider}${realmParam}`,
        {
          method: "POST",
          ...(await this.transport.request({ authenticated: false })),
          body: JSON.stringify({
            username: options.username,
            password: options.password,
          }),
          schema: { response: tokenResponseSchema },
        },
      );

      await this.signedIn(data);

      return data;
    }

    if (!this.transport.cookies) {
      throw new AlephaError(
        `Sign-in with "${provider}" opens a browser and returns through a redirect, which this app's auth transport does not support yet. Sign in with a password.`,
      );
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

  /**
   * Finish a sign-in that was interrupted by a second-factor challenge.
   *
   * Takes the challenge that {@link ReactAuth.login} refused with, plus the
   * code the user produced, and mints the real session.
   */
  public async loginMfa(
    challenge: string,
    code: string,
    options: { hostname?: string } = {},
  ): Promise<Tokens> {
    const { data } = await this.httpClient.fetch(
      this.authUrl(alephaServerAuthRoutes.mfa, options.hostname),
      {
        method: "POST",
        ...(await this.transport.request({ authenticated: false })),
        body: JSON.stringify({ challenge, code }),
        schema: { response: tokenResponseSchema },
      },
    );

    await this.signedIn(data);

    return data;
  }

  /**
   * Ask for another copy of an out-of-band code. A no-op for TOTP, whose
   * code never left the user's device in the first place.
   */
  public async resendMfaCode(
    challenge: string,
    options: { hostname?: string } = {},
  ): Promise<{ sentTo?: string }> {
    const { data } = await this.httpClient.fetch(
      this.authUrl(alephaServerAuthRoutes.mfaResend, options.hostname),
      {
        method: "POST",
        ...(await this.transport.request({ authenticated: false })),
        body: JSON.stringify({ challenge }),
        schema: {
          response: mfaResendResponseSchema,
        },
      },
    );

    return data;
  }

  /**
   * The URL of an auth route: under an explicit `hostname` when the caller
   * names one, else wherever the transport says.
   */
  protected authUrl(path: string, hostname?: string): string {
    return hostname ? `${hostname}${path}` : this.transport.url(path);
  }

  /**
   * A sign-in succeeded: hand the tokens to the transport first, then expose
   * the user. A cookie session is complete as the response says. A token
   * session is validated through `userinfo`, which is also the only answer
   * that carries the user's `sessionId`.
   */
  protected async signedIn(data: TokenResponse): Promise<void> {
    await this.transport.signedIn(data);

    if (this.transport.cookies) {
      this.alepha.store.set("alepha.server.request.apiLinks", data.api);
      this.alepha.store.set(currentUserAtom, data.user);
      return;
    }

    await this.ping();
  }

  public async logout(): Promise<void> {
    if (await this.transport.signOut()) {
      return;
    }

    const form = document.createElement("form");
    form.method = "POST";
    form.action = `${alephaServerAuthRoutes.logout}?post_logout_redirect_uri=${encodeURIComponent(window.location.origin)}`;
    form.style.display = "none";
    document.body.appendChild(form);
    form.submit();
  }
}
