import { $hook, Alepha } from "alepha";
import { $realm, AlephaApiUsers, UserService } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrm } from "alepha/orm";
import { ReactAuth, ReactAuthTransport } from "alepha/react/auth";
import { currentUserAtom } from "alepha/security";
import { AlephaServer, HttpClient, ServerProvider } from "alepha/server";
import { alephaServerAuthRoutes, tokensSchema } from "alepha/server/auth";
import { afterEach, describe, it } from "vitest";

import {
  CapacitorConfigProvider,
  MemoryCapacitorConfigProvider,
  MemoryTokenStorageProvider,
  NativeAuthTransport,
  NativeSession,
  TokenStorageProvider,
} from "../index.ts";

const PASSWORD = "Native-test-1";

class Api {
  realm = $realm({
    identities: { credentials: true },
    settings: { registrationAllowed: false },
  });
}

/**
 * Counts the refreshes the API actually received.
 */
class RefreshCounter {
  public count = 0;

  protected readonly onRequest = $hook({
    on: "server:onRequest",
    handler: ({ request }) => {
      if (request.url.pathname === alephaServerAuthRoutes.refresh) {
        this.count++;
      }
    },
  });
}

class SignOutProbe {
  public revoked: boolean[] = [];

  protected readonly onSignOut = $hook({
    on: "capacitor:auth:signout",
    handler: ({ revoked }) => {
      this.revoked.push(revoked);
    },
  });
}

const containers: Alepha[] = [];

afterEach(async () => {
  await Promise.all(containers.splice(0).map((it) => it.stop()));
});

/**
 * The test app's API, for real: a realm with password sign-in and one user.
 */
const startApi = async () => {
  const api = Alepha.create({
    env: {
      DATABASE_URL: ":memory:",
      APP_SECRET: "native-auth-spec-secret-0123456789abcdef",
      LOG_LEVEL: "error",
    },
  })
    .with(AlephaServer)
    .with(AlephaOrm)
    .with(AlephaApiUsers)
    .with(Api)
    .with(RefreshCounter);
  containers.push(api);
  await api.start();
  await api
    .inject(UserService)
    .createUser({ email: "native@test.dev", username: "native" }, undefined, {
      password: PASSWORD,
    });
  return {
    hostname: api.inject(ServerProvider).hostname,
    refreshes: api.inject(RefreshCounter),
  };
};

/**
 * A native app's container: the shell config naming the API, the native
 * transport, and storage the spec can read and seed.
 */
const startApp = async (apiUrl: string, items?: Map<string, string>) => {
  const app = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with({
      provide: CapacitorConfigProvider,
      use: MemoryCapacitorConfigProvider,
    })
    .with({ provide: TokenStorageProvider, use: MemoryTokenStorageProvider })
    .with({ provide: ReactAuthTransport, use: NativeAuthTransport })
    .with(SignOutProbe);
  containers.push(app);
  app.inject(MemoryCapacitorConfigProvider).config = {
    appId: "dev.alepha.mobile",
    variant: "base",
    scheme: "mobile",
    mode: "bundled",
    apiUrl,
    env: {},
  };
  const storage = app.inject(MemoryTokenStorageProvider);
  if (items) {
    storage.items = items;
  }
  const auth = app.inject(ReactAuth);
  await app.start();
  return {
    app,
    auth,
    storage,
    session: app.inject(NativeSession),
    transport: app.inject(NativeAuthTransport),
    config: app.inject(MemoryCapacitorConfigProvider),
    signOuts: app.inject(SignOutProbe),
    signIn: () =>
      auth.login("credentials", {
        username: "native@test.dev",
        password: PASSWORD,
      }),
  };
};

describe("native token custody", () => {
  it("signs in with a password, keeps the session in storage and validates it", async ({
    expect,
  }) => {
    const { hostname } = await startApi();
    const { app, storage, signIn } = await startApp(hostname);

    await signIn();

    const keys = [...storage.items.keys()];
    expect(keys).toContain(`alepha:dev.alepha.mobile:${hostname}`);
    expect(
      keys.some((key) =>
        key.startsWith(`alepha:dev.alepha.mobile:${hostname}:`),
      ),
    ).toBe(true);
    // From userinfo: the login response has no session yet.
    expect(app.store.get(currentUserAtom)?.sessionId).toBeTruthy();
  });

  it("calls the API's origin with a Bearer and never asks for credentials", async ({
    expect,
  }) => {
    const { hostname } = await startApi();
    const { transport, signIn } = await startApp(hostname);
    await signIn();

    const request = await transport.request({ authenticated: true });

    expect(transport.url("/_auth/userinfo")).toBe(`${hostname}/_auth/userinfo`);
    expect(request.credentials).toBe("omit");
    expect(request.headers?.authorization).toMatch(/^Bearer /);
    expect(
      (await transport.request({ authenticated: false })).headers,
    ).toBeUndefined();
  });

  it("refreshes once for every caller that asks while it runs", async ({
    expect,
  }) => {
    const { hostname, refreshes } = await startApi();
    const { app, session, signIn } = await startApp(hostname);
    await signIn();
    const before = await session.accessToken();
    // Past the access token's lifetime on the app's clock.
    await app.inject(DateTimeProvider).travel([20, "minutes"]);

    const tokens = await Promise.all([
      session.accessToken(),
      session.accessToken(),
      session.accessToken(),
    ]);

    expect(refreshes.count).toBe(1);
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toBeTruthy();
    expect(before).toBeTruthy();
  });

  it("clears the session when the server refuses the refresh", async ({
    expect,
  }) => {
    const { hostname } = await startApi();
    const { session, storage, signIn } = await startApp(hostname);
    const tokens = await signIn();
    await session.save({
      ...tokensSchema.parse(tokens),
      refresh_token: "nope",
    });

    await expect(session.refresh()).rejects.toThrow();

    expect(session.hasSession()).toBe(false);
    expect(storage.items.size).toBe(0);
  });

  it("keeps the session when the refresh gets no response", async ({
    expect,
  }) => {
    const { hostname } = await startApi();
    const { session, storage, config, signIn } = await startApp(hostname);
    await signIn();
    const stored = new Map(storage.items);
    // Nothing listens on port 1.
    const offline = { ...config.config!, apiUrl: "http://127.0.0.1:1" };
    config.config = offline;
    await session.save(
      tokensSchema.parse(
        JSON.parse(
          [...stored.entries()].find(([k]) => k.endsWith(":-"))?.[1] ?? "{}",
        ),
      ),
    );

    await expect(session.refresh()).rejects.toThrow();

    expect(session.hasSession()).toBe(true);
  });

  it("does not let a refresh in flight bring a signed-out session back", async ({
    expect,
  }) => {
    const { hostname } = await startApi();
    const { app, session, storage, transport, signIn } =
      await startApp(hostname);
    await signIn();
    await app.inject(DateTimeProvider).travel([20, "minutes"]);

    const late = session.refresh();
    await transport.signOut();
    await late.catch(() => undefined);

    expect(session.hasSession()).toBe(false);
    expect(storage.items.size).toBe(0);
  });

  it("revokes the session on the server: its refresh token is refused afterwards", async ({
    expect,
  }) => {
    const { hostname } = await startApi();
    const { app, transport, signOuts, signIn } = await startApp(hostname);
    const tokens = await signIn();

    await transport.signOut();

    expect(signOuts.revoked).toEqual([true]);
    expect(app.store.get(currentUserAtom)).toBeUndefined();
    await expect(
      app
        .inject(HttpClient)
        .fetch(
          `${hostname}${alephaServerAuthRoutes.refresh}?provider=credentials`,
          {
            method: "POST",
            body: JSON.stringify({
              refresh_token: tokens.refresh_token,
              access_token: tokens.access_token,
            }),
          },
        ),
    ).rejects.toThrow();
  });

  it("signs out locally and says so when the server cannot be reached", async ({
    expect,
  }) => {
    const { hostname } = await startApi();
    const { app, storage, config, signOuts, transport, signIn } =
      await startApp(hostname);
    await signIn();
    config.config = { ...config.config!, apiUrl: "http://127.0.0.1:1" };

    await transport.signOut();

    expect(signOuts.revoked).toEqual([false]);
    expect(storage.items.size).toBe(0);
    expect(app.store.get(currentUserAtom)).toBeUndefined();
  });

  it("restores a stored session at boot, validated by the server", async ({
    expect,
  }) => {
    const { hostname } = await startApi();
    const first = await startApp(hostname);
    await first.signIn();

    const second = await startApp(hostname, new Map(first.storage.items));
    await second.transport.restore();

    expect(second.app.store.get(currentUserAtom)?.sessionId).toBe(
      first.app.store.get(currentUserAtom)?.sessionId,
    );
  });

  it("keeps a stored session and reports offline when the API cannot be reached at boot", async ({
    expect,
  }) => {
    const { hostname } = await startApi();
    const first = await startApp(hostname);
    await first.signIn();
    const items = new Map(first.storage.items);

    const second = await startApp(hostname, items);
    second.config.config = {
      ...second.config.config!,
      apiUrl: "http://127.0.0.1:1",
    };
    // The pointer key embeds the origin: point it at the stored session.
    second.storage.items = new Map(
      [...items.entries()].map(([k, v]) => [
        k.replace(hostname, "http://127.0.0.1:1"),
        v,
      ]),
    );

    await expect(second.transport.restore()).rejects.toThrow();

    expect(second.storage.items.size).toBe(2);
    expect(second.app.store.get(currentUserAtom)).toBeUndefined();
  });

  it("refuses a redirect sign-in it cannot complete", async ({ expect }) => {
    const { hostname } = await startApi();
    const { auth } = await startApp(hostname);

    await expect(auth.login("google", {})).rejects.toThrow(
      /does not support yet/,
    );
  });
});
