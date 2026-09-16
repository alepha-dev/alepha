import { Alepha, z } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreTokenStore } from "../services/LoreTokenStore.ts";

/**
 * Lore's token endpoint, as far as a refresh sees it. The real one, and the
 * rule that lets `alepha-cli` refresh at all, is covered by
 * `OAuthController.spec.ts`; this pins what the CLI sends and what it does
 * with each answer.
 */
class FakeTokenEndpoint {
  public answer: { status: number; body: Record<string, unknown> } = {
    status: 200,
    body: { access_token: "fresh", expires_in: 900, refresh_token: "r1" },
  };

  public requests: Array<Record<string, string | undefined>> = [];

  public token = $route({
    method: "POST",
    path: "/oauth/token",
    schema: {
      body: z.object({
        grant_type: z.text().optional(),
        refresh_token: z.text().optional(),
        client_id: z.text().optional(),
      }),
    },
    use: [],
    handler: async ({ body, reply }) => {
      this.requests.push(body);
      reply.status = this.answer.status;
      reply.headers["content-type"] = "application/json";
      reply.body = JSON.stringify(this.answer.body);
    },
  });
}

/**
 * Which credential a command uses, and where a device-flow token is kept.
 *
 * ⚠️ The precedence is the half that can hang a CI job. There is no human on a
 * runner to approve a device code, so a missing key must be a fast error and
 * never a login: `authorization()` NEVER starts a flow, and `lore login`
 * refuses to run in CI at all.
 */
describe("Lore credentials", () => {
  const setup = async (env: Record<string, string> = {}) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        HOME: "/home/dev",
        LORE_API_KEY: "",
        LORE_URL: "https://lore.example.test",
        ...env,
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with(AlephaDateTime)
      .with(LoreTokenStore)
      .with(LoreClientService);

    await alepha.start();

    return {
      alepha,
      client: alepha.inject(LoreClientService),
      tokens: alepha.inject(LoreTokenStore),
      dateTime: alepha.inject(DateTimeProvider),
      fs: alepha.inject(MemoryFileSystemProvider),
    };
  };

  describe("the store", () => {
    /**
     * One laptop can talk to the public Lore and to a self-hosted one, and a
     * token minted by either is worthless to the other - worse, sending one to
     * the other hands a credential to a host that was never meant to see it.
     */
    it("keeps one token per hostname", async () => {
      const ctx = await setup();

      await ctx.tokens.write("https://lore.alepha.dev", {
        accessToken: "public-token",
      });
      await ctx.tokens.write("https://lore.internal", {
        accessToken: "self-hosted-token",
      });

      expect(await ctx.tokens.read("https://lore.alepha.dev")).toBe(
        "public-token",
      );
      expect(await ctx.tokens.read("https://lore.internal")).toBe(
        "self-hosted-token",
      );
    });

    /**
     * ⚠️ `writeFile` takes no mode, so the file lands with whatever the umask
     * allows. The DIRECTORY is what protects it - the same thing `~/.ssh`
     * relies on.
     */
    it("creates its directory private", async () => {
      const ctx = await setup();

      await ctx.tokens.write("https://lore.example.test", {
        accessToken: "t",
      });

      expect(ctx.fs.wasWritten("/home/dev/.alepha/credentials.json")).toBe(
        true,
      );
      const mkdir = ctx.fs.mkdirCalls.find(
        (call) => call.path === "/home/dev/.alepha",
      );
      expect(mkdir?.options?.mode).toBe(0o700);
    });

    /**
     * An expired token sent anyway is refused by the server, and the refusal
     * reads as "your key is wrong" rather than "log in again".
     */
    it("treats an expired token as absent", async () => {
      const ctx = await setup();

      await ctx.tokens.write("https://lore.example.test", {
        accessToken: "stale",
        expiresAt: ctx.dateTime.now().subtract(1, "hour").toISOString(),
      });

      expect(
        await ctx.tokens.read("https://lore.example.test"),
      ).toBeUndefined();
    });

    it("keeps a token that names no expiry", async () => {
      const ctx = await setup();

      await ctx.tokens.write("https://lore.example.test", {
        accessToken: "forever",
      });

      expect(await ctx.tokens.read("https://lore.example.test")).toBe(
        "forever",
      );
    });

    /**
     * A stray byte in a cache must not stop every command in the plugin
     * working, since the fix - delete the file - is not something the error
     * would have suggested.
     */
    it("reads an unparseable file as empty rather than throwing", async () => {
      const ctx = await setup();
      await ctx.fs.writeFile("/home/dev/.alepha/credentials.json", "{ not");

      expect(
        await ctx.tokens.read("https://lore.example.test"),
      ).toBeUndefined();
    });

    it("reports whether a logout had anything to forget", async () => {
      const ctx = await setup();

      expect(await ctx.tokens.clear("https://lore.example.test")).toBe(false);

      await ctx.tokens.write("https://lore.example.test", { accessToken: "t" });
      expect(await ctx.tokens.clear("https://lore.example.test")).toBe(true);
      expect(
        await ctx.tokens.read("https://lore.example.test"),
      ).toBeUndefined();
    });
  });

  describe("the precedence", () => {
    it("uses LORE_API_KEY when there is one", async () => {
      const ctx = await setup({ LORE_API_KEY: "lore_secret" });

      expect(await ctx.client.authorization()).toBe("Bearer lore_secret");
    });

    it("falls back to the cached token for this hostname", async () => {
      const ctx = await setup();
      await ctx.tokens.write("https://lore.example.test", {
        accessToken: "device-token",
      });

      expect(await ctx.client.authorization()).toBe("Bearer device-token");
    });

    /**
     * A machine with both is a laptop with a key exported for a one-off, and
     * the explicit thing somebody just typed should win over a cache.
     */
    it("prefers the key over a cached token", async () => {
      const ctx = await setup({ LORE_API_KEY: "lore_secret" });
      await ctx.tokens.write("https://lore.example.test", {
        accessToken: "device-token",
      });

      expect(await ctx.client.authorization()).toBe("Bearer lore_secret");
    });

    /**
     * ⚠️ The property that keeps CI from hanging: a missing credential is an
     * error, never a login. Nothing in this path can start a device flow.
     */
    it("errors naming both fixes rather than starting a flow", async () => {
      const ctx = await setup();

      await expect(ctx.client.authorization()).rejects.toThrow(
        /lore login[\s\S]*LORE_API_KEY/,
      );
    });

    /**
     * A token cached for another instance must not be sent to this one.
     */
    it("ignores a token cached for a different hostname", async () => {
      const ctx = await setup();
      await ctx.tokens.write("https://lore.alepha.dev", {
        accessToken: "elsewhere",
      });

      await expect(ctx.client.authorization()).rejects.toThrow();
    });
  });

  /**
   * #Q2387. Lore's access tokens last fifteen minutes, and the refresh token
   * stored beside one was never sent, so a `lore login` lasted fifteen
   * minutes.
   */
  describe("the refresh", () => {
    const setupWithEndpoint = async (env: Record<string, string> = {}) => {
      const server = Alepha.create({
        env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
      })
        .with(AlephaServer)
        .with(FakeTokenEndpoint);
      await server.start();

      // The port is only known once the server is up, and the CLI resolves
      // `LORE_URL` when it boots: two containers, in this order.
      const hostname = server.inject(ServerProvider).hostname;
      const ctx = await setup({ LORE_URL: hostname, ...env });
      return {
        ...ctx,
        hostname,
        endpoint: server.inject(FakeTokenEndpoint),
      };
    };

    const writeExpired = async (
      ctx: Awaited<ReturnType<typeof setupWithEndpoint>>,
      withRefreshToken = true,
    ) => {
      await ctx.tokens.write(ctx.hostname, {
        accessToken: "stale",
        refreshToken: withRefreshToken ? "r0" : undefined,
        expiresAt: ctx.dateTime.now().subtract(1, "hour").toISOString(),
      });
    };

    it("trades an expired login for a fresh token, and keeps it", async () => {
      const ctx = await setupWithEndpoint();
      // Frozen, so the expiry below is exact rather than a few ms off.
      ctx.dateTime.pause();
      await writeExpired(ctx);

      expect(await ctx.client.authorization()).toBe("Bearer fresh");

      // Under the client the login was granted to: the server binds the
      // session to it and refuses a refresh under any other.
      expect(ctx.endpoint.requests).toEqual([
        {
          grant_type: "refresh_token",
          refresh_token: "r0",
          client_id: "alepha-cli",
        },
      ]);
      expect(await ctx.tokens.entry(ctx.hostname)).toEqual({
        accessToken: "fresh",
        refreshToken: "r1",
        expiresAt: ctx.dateTime.now().add(900, "seconds").toISOString(),
      });
    });

    it("sends nothing while the cached token is still good", async () => {
      const ctx = await setupWithEndpoint();
      await ctx.tokens.write(ctx.hostname, {
        accessToken: "current",
        refreshToken: "r0",
        expiresAt: ctx.dateTime.now().add(10, "minutes").toISOString(),
      });

      expect(await ctx.client.authorization()).toBe("Bearer current");
      expect(ctx.endpoint.requests).toHaveLength(0);
    });

    /**
     * RFC 6749 §6 lets a server keep the old refresh token valid and name
     * none. Dropping it would end the login at the next expiry.
     */
    it("keeps the refresh token it had when the answer names none", async () => {
      const ctx = await setupWithEndpoint();
      ctx.endpoint.answer.body = { access_token: "fresh", expires_in: 900 };
      await writeExpired(ctx);

      await ctx.client.authorization();

      expect((await ctx.tokens.entry(ctx.hostname))?.refreshToken).toBe("r0");
    });

    it("refreshes once for requests that ask at the same time", async () => {
      const ctx = await setupWithEndpoint();
      await writeExpired(ctx);

      const headers = await Promise.all([
        ctx.client.authorization(),
        ctx.client.authorization(),
        ctx.client.authorization(),
      ]);

      expect(headers).toEqual(["Bearer fresh", "Bearer fresh", "Bearer fresh"]);
      expect(ctx.endpoint.requests).toHaveLength(1);
    });

    /**
     * A refusal means the session is gone: revoked, or idle past its window.
     * Keeping the entry would send the dead token again on every command.
     */
    it("forgets a login the server refuses, and asks for a new one", async () => {
      const ctx = await setupWithEndpoint();
      ctx.endpoint.answer = { status: 400, body: { error: "invalid_grant" } };
      await writeExpired(ctx);

      await expect(ctx.client.authorization()).rejects.toThrow(/lore login/);
      expect(await ctx.tokens.entry(ctx.hostname)).toBeUndefined();
    });

    /**
     * ⚠️ The other half of the rule above: an outage is not a refusal, and
     * must not cost the laptop the login it would work with again tomorrow.
     */
    it("keeps the login when the server fails rather than refuses", async () => {
      const ctx = await setupWithEndpoint();
      ctx.endpoint.answer = { status: 503, body: { error: "unavailable" } };
      await writeExpired(ctx);

      await expect(ctx.client.authorization()).rejects.toThrow();
      expect((await ctx.tokens.entry(ctx.hostname))?.refreshToken).toBe("r0");
    });

    it("asks for a login when the expired token carries nothing to refresh", async () => {
      const ctx = await setupWithEndpoint();
      await writeExpired(ctx, false);

      await expect(ctx.client.authorization()).rejects.toThrow(/lore login/);
      expect(ctx.endpoint.requests).toHaveLength(0);
    });

    /**
     * The key still wins, and a laptop with one exported never spends its
     * stored login on a refresh it does not need.
     */
    it("does not refresh when LORE_API_KEY is set", async () => {
      // Through the boot env: `$env` is read when the container starts.
      const ctx = await setupWithEndpoint({ LORE_API_KEY: "lore_secret" });
      await writeExpired(ctx);

      expect(await ctx.client.authorization()).toBe("Bearer lore_secret");
      expect(ctx.endpoint.requests).toHaveLength(0);
    });
  });
});
