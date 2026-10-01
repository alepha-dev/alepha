import { randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, $secure, AlephaSecurity } from "alepha/security";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AdminApiKeyController } from "../controllers/AdminApiKeyController.ts";
import { ApiKeyController } from "../controllers/ApiKeyController.ts";
import { AlephaApiKeys } from "../index.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

class TestApp {
  issuer = $issuer({
    secret: "test-secret",
    roles: [{ name: "admin", permissions: [{ name: "*" }] }],
  });

  whoami = $action({
    use: [$secure()],
    schema: { response: z.object({ ip: z.string().optional() }) },
    handler: (request) => ({ ip: request.ip }),
  });
}

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiKeys);
  const app = alepha.inject(TestApp);
  const service = alepha.inject(ApiKeyService);
  const background = alepha.inject(BackgroundTaskProvider);
  await alepha.start();
  app.issuer.registerResolver(service.createResolver());

  const userId = randomUUID();
  const { hostname } = alepha.inject(ServerProvider);

  /**
   * `GET /whoami` with the key, from whatever address `X-Real-IP` names.
   * `TRUST_PROXY` is on by default, so the header becomes `request.ip`.
   */
  const call = (token: string, realIp?: string) =>
    fetch(`${hostname}/api/whoami?api_key=${encodeURIComponent(token)}`, {
      headers: realIp === undefined ? {} : { "x-real-ip": realIp },
    });

  return { alepha, app, service, background, userId, call };
};

describe("an API key's IP allowlist", () => {
  describe("at creation", () => {
    it("refuses a malformed entry, naming it, and stores nothing", async () => {
      const { service, userId } = await setup();

      await expect(
        service.create({
          userId,
          name: "CI",
          roles: ["admin"],
          ipAllowlist: ["203.0.113.4", "10.0.0.0/33", "runner.example.com"],
        }),
      ).rejects.toThrow(
        "Invalid IP allowlist entries: '10.0.0.0/33', 'runner.example.com'",
      );

      expect(await service.list(userId)).toHaveLength(0);
    });

    it("refuses it through the endpoint too, before anything is minted", async () => {
      const { alepha, service, userId } = await setup();
      const controller = alepha.inject(ApiKeyController);

      await expect(
        controller.createApiKey.run(
          { body: { name: "CI", ipAllowlist: ["1.2.3"] } },
          { user: { id: userId, roles: ["admin"] } },
        ),
      ).rejects.toThrow("'1.2.3'");
      expect(await service.list(userId)).toHaveLength(0);
    });

    it("stores entries trimmed and once, and publishes them on every read", async () => {
      const { alepha, userId } = await setup();
      const controller = alepha.inject(ApiKeyController);
      const user = { id: userId, roles: ["admin"] };

      const created = await controller.createApiKey.run(
        {
          body: {
            name: "CI",
            ipAllowlist: [" 203.0.113.4", "203.0.113.4", "2001:db8::/32"],
          },
        },
        { user },
      );
      expect(created.ipAllowlist).toEqual(["203.0.113.4", "2001:db8::/32"]);

      const listed = await controller.listApiKeys.run({}, { user });
      expect(listed[0].ipAllowlist).toEqual(["203.0.113.4", "2001:db8::/32"]);

      const admin = await alepha
        .inject(AdminApiKeyController)
        .findApiKeys.run(
          { query: { userId } },
          { user: { id: randomUUID(), roles: ["admin"] } },
        );
      expect(admin.content[0].ipAllowlist).toEqual([
        "203.0.113.4",
        "2001:db8::/32",
      ]);
    });
  });

  describe("in validate()", () => {
    it("admits an address the allowlist names and refuses any other", async () => {
      const { service, userId } = await setup();
      const { token } = await service.create({
        userId,
        name: "CI",
        roles: ["admin"],
        ipAllowlist: ["203.0.113.0/24"],
      });

      expect(
        (await service.validate(token, undefined, "203.0.113.9"))?.id,
      ).toBe(userId);
      expect(
        await service.validate(token, undefined, "198.51.100.1"),
      ).toBeNull();
    });

    it("refuses a restricted key when no address is known, rather than skipping the check", async () => {
      // A direct call with no request: no `ip` argument and nothing stored.
      // Written as "no IP, no check" this would admit every caller that
      // forgot to pass one.
      const { service, userId } = await setup();
      const { token } = await service.create({
        userId,
        name: "CI",
        roles: ["admin"],
        ipAllowlist: ["0.0.0.0/0", "::/0"],
      });

      expect(await service.validate(token)).toBeNull();
    });

    it("leaves a key without an allowlist usable from an unknown address", async () => {
      const { service, userId } = await setup();
      const { token } = await service.create({
        userId,
        name: "CI",
        roles: ["admin"],
      });

      expect((await service.validate(token))?.id).toBe(userId);
    });
  });

  describe("over HTTP", () => {
    it("authenticates from an allowed address and answers 401 from any other", async () => {
      const { service, userId, call } = await setup();
      const { token } = await service.create({
        userId,
        name: "CI",
        roles: ["admin"],
        ipAllowlist: ["203.0.113.4"],
      });

      const allowed = await call(token, "203.0.113.4");
      expect(allowed.status).toBe(200);
      // Proves the header is what the check read.
      expect(await allowed.json()).toEqual({ ip: "203.0.113.4" });

      expect((await call(token, "203.0.113.5")).status).toBe(401);
    });

    it("answers 401, not 500, to a malformed or oversized client address", async () => {
      const { service, userId, call } = await setup();
      const { token } = await service.create({
        userId,
        name: "CI",
        roles: ["admin"],
        ipAllowlist: ["0.0.0.0/0", "::/0"],
      });

      expect((await call(token, "a".repeat(4_000))).status).toBe(401);
      expect((await call(token, "203.0.113.4, 10.0.0.1")).status).toBe(401);
    });

    it("records no usage for a refused request", async () => {
      const { service, background, userId, call } = await setup();
      const { apiKey, token } = await service.create({
        userId,
        name: "CI",
        roles: ["admin"],
        ipAllowlist: ["203.0.113.4"],
      });

      expect((await call(token, "198.51.100.1")).status).toBe(401);
      await background.flush();

      const row = await service.getById(apiKey.id);
      expect(row.usageCount).toBe(0);
      expect(row.lastUsedAt).toBeUndefined();
    });
  });

  describe("through a rotation", () => {
    it("keeps the allowlist, and checks the new secret against it", async () => {
      const { service, userId, call } = await setup();
      const { apiKey } = await service.create({
        userId,
        name: "CI",
        roles: ["admin"],
        ipAllowlist: ["203.0.113.4", "2001:db8::/32"],
      });

      const rotated = await service.rotate(apiKey.id, userId);

      expect(rotated.apiKey.ipAllowlist).toEqual([
        "203.0.113.4",
        "2001:db8::/32",
      ]);
      expect((await service.getById(apiKey.id)).ipAllowlist).toEqual([
        "203.0.113.4",
        "2001:db8::/32",
      ]);
      expect((await call(rotated.token, "2001:db8::7")).status).toBe(200);
      expect((await call(rotated.token, "198.51.100.1")).status).toBe(401);
    });
  });
});
