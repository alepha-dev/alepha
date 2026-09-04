import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreTokenStore } from "../services/LoreTokenStore.ts";

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

      await expect(ctx.client.authorization()).rejects.toThrowError(
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

      await expect(ctx.client.authorization()).rejects.toThrowError();
    });
  });
});
