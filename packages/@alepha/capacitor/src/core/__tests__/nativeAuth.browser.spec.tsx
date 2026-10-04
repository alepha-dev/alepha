import { $hook, Alepha, z } from "alepha";
import { AlephaReact } from "alepha/react";
import {
  AlephaReactAuth,
  ReactAuth,
  ReactAuthTransport,
} from "alepha/react/auth";
import { $page } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { $action } from "alepha/server";
import { LinkProvider } from "alepha/server/links";
import { act } from "react";
import { beforeEach, describe, it } from "vitest";

import {
  AlephaCapacitor,
  CapacitorConfigProvider,
  MemoryCapacitorConfigProvider,
  MemoryTokenStorageProvider,
  NativeAuthTransport,
  NativeSession,
  TokenStorageProvider,
} from "../index.ts";

class Api {
  ping = $action({
    schema: { response: z.text() },
    handler: () => "pong",
  });
}

/**
 * Every request about to leave: URL, credentials mode, authorization.
 */
class FetchProbe {
  public requests: Array<{
    url: string;
    credentials?: RequestCredentials;
    authorization?: string;
  }> = [];

  protected readonly capture = $hook({
    on: "client:beforeFetch",
    handler: ({ url, request }) => {
      this.requests.push({
        url,
        credentials: request.credentials,
        authorization:
          new Headers(request.headers).get("authorization") ?? undefined,
      });
    },
  });
}

const shellConfig = (apiUrl: string) => ({
  appId: "dev.alepha.mobile",
  variant: "base",
  scheme: "mobile",
  mode: "bundled" as const,
  apiUrl,
  env: {},
});

/**
 * A session the far future will still accept, without a server.
 */
const futureTokens = {
  provider: "credentials",
  access_token: "native-access-token",
  refresh_token: "native-refresh-token",
  issued_at: 4_000_000_000,
  expires_in: 900,
};

const nativeApp = (apiUrl: string) => {
  const alepha = Alepha.create()
    .with({
      provide: CapacitorConfigProvider,
      use: MemoryCapacitorConfigProvider,
    })
    .with({ provide: TokenStorageProvider, use: MemoryTokenStorageProvider })
    .with({ provide: ReactAuthTransport, use: NativeAuthTransport })
    .with(FetchProbe);
  alepha.inject(MemoryCapacitorConfigProvider).config = shellConfig(apiUrl);
  return alepha;
};

describe("ReactAuth in a browser", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("keeps the web's cookie transport when nothing is substituted", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaReactAuth).with(FetchProbe);
    await alepha.start();

    await alepha
      .inject(ReactAuth)
      .login("credentials", { username: "u", password: "p" })
      .catch(() => undefined);

    const [login] = alepha.inject(FetchProbe).requests;
    expect(login.url).toBe("/_auth/token?provider=credentials");
    expect(login.credentials).toBeUndefined();
    expect(login.authorization).toBeUndefined();
  });

  it("signs in against the API's origin, credentials omitted, natively", async ({
    expect,
  }) => {
    const alepha = nativeApp("https://api.test");
    await alepha.start();

    await alepha
      .inject(ReactAuth)
      .login("credentials", { username: "u", password: "p" })
      .catch(() => undefined);

    const [login] = alepha.inject(FetchProbe).requests;
    expect(login.url).toBe("https://api.test/_auth/token?provider=credentials");
    expect(login.credentials).toBe("omit");
  });

  it("gives the Bearer to the API's origin and to nobody else", async ({
    expect,
  }) => {
    const alepha = nativeApp("https://api.test").with(AlephaCapacitor);
    await alepha.start();
    await alepha.inject(NativeSession).save(futureTokens);
    alepha.store.set(currentUserAtom, { id: "u1", roles: ["user"] });
    const links = alepha.inject(LinkProvider);

    await links
      .client<Api>()
      .ping({})
      .catch(() => undefined);
    await links
      .client<Api>({ hostname: "https://other.test" })
      .ping({})
      .catch(() => undefined);

    const requests = alepha.inject(FetchProbe).requests;
    expect(requests[0]).toEqual({
      url: "https://api.test/api/_links",
      credentials: undefined,
      authorization: "Bearer native-access-token",
    });
    expect(requests[1].url).toBe("https://other.test/api/_links");
    expect(requests[1].authorization).toBeUndefined();
    // The cookie hook stays quiet natively, even signed in.
    expect(requests.every((r) => r.credentials !== "include")).toBe(true);
  });

  it("boots to the offline screen with the session kept and not exposed when the API is unreachable", async ({
    expect,
  }) => {
    class App {
      home = $page({ path: "/", component: () => <p>home</p> });
    }
    // Nothing listens on port 1.
    const alepha = nativeApp("http://127.0.0.1:1")
      .with(AlephaCapacitor)
      .with(AlephaReact)
      .with(App);
    const storage = alepha.inject(MemoryTokenStorageProvider);
    storage.items.set("alepha:dev.alepha.mobile:http://127.0.0.1:1", "");
    storage.items.set(
      "alepha:dev.alepha.mobile:http://127.0.0.1:1:-",
      JSON.stringify(futureTokens),
    );

    await act(async () => {
      await alepha.start();
    });
    await act(async () => {});

    expect(
      document
        .querySelector("[data-alepha-offline]")
        ?.getAttribute("data-alepha-offline"),
    ).toBe("network");
    expect(storage.items.size).toBe(2);
    expect(alepha.store.get(currentUserAtom)).toBeUndefined();
  });
});
