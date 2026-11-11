import { Alepha, AlephaError } from "alepha";
import { AlephaServer, ServerProvider } from "alepha/server";

import {
  type MockOidcCall,
  type MockOidcOptions,
  MockOidcProvider,
} from "./providers/MockOidcProvider.ts";

/**
 * A {@link MockOidcProvider} on a real HTTP port, in an Alepha container of its
 * own, so it is a separate server from the app under test exactly as a real
 * identity provider is.
 *
 * ```ts
 * import { MockOidcServer } from "alepha/testing/oidc";
 *
 * const idp = await MockOidcServer.start({ clients: [{ clientId: "web" }] });
 *
 * class App {
 *   keycloak = $auth({ oidc: { issuer: idp.issuer, clientId: "web" } });
 * }
 *
 * await idp.stop();
 * ```
 *
 * Plain http on `127.0.0.1` is accepted by `$auth` outside production.
 */
export class MockOidcServer {
  /**
   * Start a provider on `port`, or on a free port when it is omitted.
   */
  public static async start(
    options: MockOidcOptions & { port?: number } = {},
  ): Promise<MockOidcServer> {
    const { port, ...rest } = options;
    const alepha = Alepha.create({
      env: {
        SERVER_PORT: port ?? 0,
        SERVER_HOST: "127.0.0.1",
        LOG_LEVEL: process.env.LOG_LEVEL ?? "error",
      },
    });
    alepha.with(AlephaServer);
    alepha.with(MockOidcProvider);

    const provider = alepha.inject(MockOidcProvider);
    provider.configure(rest);

    await alepha.start();

    provider.origin = alepha
      .inject(ServerProvider)
      .hostname.replace("localhost", "127.0.0.1");

    return new MockOidcServer(alepha, provider);
  }

  protected readonly alepha: Alepha;
  public readonly provider: MockOidcProvider;

  protected constructor(alepha: Alepha, provider: MockOidcProvider) {
    this.alepha = alepha;
    this.provider = provider;
  }

  /**
   * The issuer identifier: what `oidc.issuer` names, and the `iss` of every
   * token this provider signs.
   */
  public get issuer(): string {
    return this.provider.issuer;
  }

  /**
   * Every request that reached the provider, in order.
   */
  public get calls(): MockOidcCall[] {
    return this.provider.calls;
  }

  /**
   * Change what the provider answers with, from the next request on.
   */
  public configure(options: MockOidcOptions): void {
    this.provider.configure(options);
  }

  /**
   * Deliver a back-channel logout token to a relying party, as a provider
   * does when a session ends elsewhere: a form post of `logout_token` to
   * `url`. Answers the relying party's response.
   */
  public async backchannelLogout(
    url: string,
    options: Parameters<MockOidcProvider["createLogoutToken"]>[0],
  ): Promise<Response> {
    const token = await this.provider.createLogoutToken(options);
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ logout_token: token }).toString(),
    });
  }

  public async stop(): Promise<void> {
    if (!this.alepha.isStarted()) {
      throw new AlephaError("The mock OIDC server is not running");
    }
    await this.alepha.stop();
  }
}
