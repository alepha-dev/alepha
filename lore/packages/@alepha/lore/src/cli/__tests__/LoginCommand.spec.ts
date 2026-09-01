import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import { AlephaDateTime } from "alepha/datetime";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { LoginCommand } from "../commands/LoginCommand.ts";
import { LoreTokenStore } from "../services/LoreTokenStore.ts";

/**
 * `alepha lore login` - the OAuth 2.0 device flow, from the client side.
 *
 * The server half is `alepha/api/oauth` and is not retested here. What is
 * worth asserting is the loop: RFC 8628 §3.5 answers "not approved yet" with a
 * **400**, which is a status `HttpClient` throws on, so the ordinary poll runs
 * down an error path. Get that wrong and every login fails on its first tick.
 */
class FakeAuthServer {
  /**
   * What the next poll answers. A list, so a case can make the flow wait
   * before it succeeds - which is the normal shape and the one a naive
   * implementation gets wrong.
   */
  public answers: Array<Record<string, unknown>> = [];
  public polls = 0;

  public deviceAuthorization = $route({
    method: "POST",
    path: "/oauth/device_authorization",
    use: [],
    handler: async ({ reply }) => {
      reply.headers["content-type"] = "application/json";
      reply.body = JSON.stringify({
        device_code: "dev-code",
        user_code: "WDJB-MJHT",
        verification_uri: "https://lore.example.test/device",
        verification_uri_complete:
          "https://lore.example.test/device?user_code=WDJB-MJHT",
        expires_in: 60,
        // Zero, so the suite does not spend five seconds per tick waiting for
        // a human who is a fixture.
        interval: 0,
      });
    },
  });

  public token = $route({
    method: "POST",
    path: "/oauth/token",
    use: [],
    handler: async ({ reply }) => {
      const answer = this.answers[this.polls] ?? { error: "expired_token" };
      this.polls++;
      reply.headers["content-type"] = "application/json";
      // A pending grant is a 400 BY DESIGN, per RFC 8628 §3.5.
      reply.status = answer.access_token ? 200 : 400;
      reply.body = JSON.stringify(answer);
    },
  });
}

describe("alepha lore login", () => {
  const setup = async (env: Record<string, string> = {}) => {
    const server = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaServer)
      .with(FakeAuthServer);
    await server.start();

    // Two containers: the CLI resolves `LORE_URL` when it boots, and the
    // port is only known after the server starts. Writing `alepha.env` after
    // `start()` looks like it works and does not.
    const cli = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        HOME: "/home/dev",
        CI: "",
        LORE_URL: server.inject(ServerProvider).hostname,
        ...env,
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with(AlephaDateTime)
      .with(LoreTokenStore)
      .with(LoginCommand);
    await cli.start();

    return {
      server,
      cli,
      auth: server.inject(FakeAuthServer),
      command: cli.inject(LoginCommand),
      runner: cli.inject(CliProvider),
      tokens: cli.inject(LoreTokenStore),
      hostname: server.inject(ServerProvider).hostname,
    };
  };

  it("stores the token the grant returns", async () => {
    const ctx = await setup();
    ctx.auth.answers = [
      { access_token: "granted", expires_in: 3600, refresh_token: "r" },
    ];

    await ctx.runner.run(ctx.command.login, {});

    expect(await ctx.tokens.read(ctx.hostname)).toBe("granted");
  });

  /**
   * ⚠️ The branch a naive client gets wrong: `authorization_pending` arrives
   * as a 400, which `HttpClient` throws on. A login that treated the first
   * tick as a failure would never work at all, since nobody approves a code
   * within one poll interval.
   */
  it("keeps waiting through authorization_pending", async () => {
    const ctx = await setup();
    ctx.auth.answers = [
      { error: "authorization_pending" },
      { error: "authorization_pending" },
      { access_token: "granted", expires_in: 3600 },
    ];

    await ctx.runner.run(ctx.command.login, {});

    expect(ctx.auth.polls).toBe(3);
    expect(await ctx.tokens.read(ctx.hostname)).toBe("granted");
  });

  /**
   * A refusal is not a timeout: "the user said no" should cost one more tick,
   * not ten minutes of polling.
   */
  it("stops immediately when the sign-in is refused", async () => {
    const ctx = await setup();
    ctx.auth.answers = [{ error: "access_denied" }];

    await expect(ctx.runner.run(ctx.command.login, {})).rejects.toThrowError(
      /refused/,
    );
    expect(ctx.auth.polls).toBe(1);
    expect(await ctx.tokens.read(ctx.hostname)).toBeUndefined();
  });

  it("gives up when the code expires", async () => {
    const ctx = await setup();
    ctx.auth.answers = [{ error: "expired_token" }];

    await expect(ctx.runner.run(ctx.command.login, {})).rejects.toThrowError(
      /expired/,
    );
  });

  /**
   * ⚠️ The whole point of objective 4. There is nobody on a runner to approve
   * a code, so a login there polls until it times out - a job that hangs for
   * minutes and then fails for a reason its log does not explain.
   */
  it("refuses to run in CI, naming the variable to set instead", async () => {
    const ctx = await setup({ CI: "true" });

    await expect(ctx.runner.run(ctx.command.login, {})).rejects.toThrowError(
      /LORE_API_KEY/,
    );
    // Not even the first request: the refusal comes before the flow starts.
    expect(ctx.auth.polls).toBe(0);
  });

  describe("logout", () => {
    it("forgets this hostname's token", async () => {
      const ctx = await setup();
      await ctx.tokens.write(ctx.hostname, { accessToken: "granted" });

      await ctx.runner.run(ctx.command.logout, {});

      expect(await ctx.tokens.read(ctx.hostname)).toBeUndefined();
    });

    it("is not an error when there was nothing stored", async () => {
      const ctx = await setup();

      await expect(
        ctx.runner.run(ctx.command.logout, {}),
      ).resolves.toBeUndefined();
    });
  });
});
