import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $issuer } from "alepha/security";
import { HttpClient, ServerProvider } from "alepha/server";
import { $client } from "alepha/server/links";
import { AlephaServerSecurity } from "alepha/server/security";
import { describe, test } from "vitest";
import {
  $auth,
  alephaServerAuthRoutes,
  type TokenResponse,
  tokenResponseSchema,
  tokensSchema
} from "alepha/server/auth";
import { ReactAuth, ReactAuthProvider } from "../index.ts";

describe("$auth", () => {
    const user = {
      id: randomUUID(),
      name: "John Doe",
      username: "john",
      password: "***",
      roles: ["admin"],
    };

    class App {
      issuer = $issuer({
        secret: "my-secret-key",
        roles: [
          {
            name: "admin",
            permissions: [{ name: "*" }],
          },
        ],
      });

      auth = $auth({
        issuer: this.issuer,
        credentials: {
          account: () => user,
        },
      });

      api = $client<ReactAuthProvider>();
    }

    const userinfo = (alepha: Alepha, token?: string) =>
      alepha
        .inject(HttpClient)
        .fetch(
          `${alepha.inject(ServerProvider).hostname}${alephaServerAuthRoutes.userinfo}`,
          {
            method: "GET",
            headers: {
              authorization: `Bearer ${token}`,
            },
          },
        )
        .then((it) => it.data);

    const login = (alepha: Alepha) =>
      alepha
        .inject(HttpClient)
        .fetch(
          `${alepha.inject(ServerProvider).hostname}${alephaServerAuthRoutes.token}?provider=auth`,
          {
            method: "POST",
            body: JSON.stringify({
              username: user.username,
              password: user.password,
            }),
            schema: {
              response: tokenResponseSchema,
            },
          },
        );

    const refresh = (alepha: Alepha, tokens: TokenResponse) =>
      alepha
        .inject(HttpClient)
        .fetch(
          `${alepha.inject(ServerProvider).hostname}${alephaServerAuthRoutes.refresh}?provider=auth`,
          {
            method: "POST",
            body: JSON.stringify({
              refresh_token: tokens.refresh_token!,
              access_token: tokens.access_token,
            }),
            schema: {
              response: tokensSchema,
            },
          },
        );

    test("should login with credentials", async ({ expect }) => {
      const alepha = Alepha.create().with(App).with(AlephaServerSecurity);
      const auth = alepha.inject(ReactAuth);
      await alepha.start();

      expect(auth.user).toBeUndefined();
      await auth.login("auth", {
        username: user.username,
        password: user.password,
        hostname: alepha.inject(ServerProvider).hostname,
      });
      expect(auth.user).toEqual({
        id: user.id,
        name: user.name,
        roles: user.roles,
        username: user.username,
      });
    });

    test("should get userinfo", async ({ expect }) => {
      const alepha = Alepha.create().with(App).with(AlephaServerSecurity);
      await alepha.start();

      const { data: tokens } = await login(alepha);

      expect(await userinfo(alepha, tokens.access_token)).toEqual({
        user: {
          id: user.id,
          name: user.name,
          roles: user.roles,
          username: user.username,
          sessionId: expect.any(String),
        },
        api: {
          prefix: "/api",
          links: [],
        },
      });
    });

    test("should reject expired token", async ({ expect }) => {
      const alepha = Alepha.create().with(App);
      await alepha.start();

      const { data: tokens } = await login(alepha);

      await alepha.inject(DateTimeProvider).travel(1, "hour");

      expect(await userinfo(alepha, tokens.access_token)).toEqual({
        api: {
          prefix: "/api",
          links: [],
        },
      });
    });

    test("should refresh expired token", async ({ expect }) => {
      const alepha = Alepha.create().with(App);
      await alepha.start();

      const { data: tokens } = await login(alepha);

      await alepha.inject(DateTimeProvider).travel(1, "hour");

      const { data: tokens2 } = await refresh(alepha, tokens);

      expect(await userinfo(alepha, tokens2.access_token)).toEqual({
        user: {
          id: user.id,
          name: user.name,
          roles: user.roles,
          username: user.username,
        },
        api: {
          prefix: "/api",
          links: [],
        },
      });
    });

    test("should reject expired refresh token", async ({ expect }) => {
      const alepha = Alepha.create().with(App);
      await alepha.start();

      const { data: tokens } = await login(alepha);

      await alepha.inject(DateTimeProvider).travel(40, "days");

      await expect(refresh(alepha, tokens)).rejects.toThrowError(
        "Failed to refresh access token using the refresh token (issuer)",
      );
    });
});
