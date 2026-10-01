import { randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import {
  $issuer,
  $permission,
  $secure,
  AlephaSecurity,
  type UserAccountToken,
} from "alepha/security";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { ApiKeyController } from "../controllers/ApiKeyController.ts";
import { apiKeyEntity } from "../entities/apiKeyEntity.ts";
import { AlephaApiKeys } from "../index.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

class TestApp {
  keys = $repository(apiKeyEntity);

  issuer = $issuer({
    name: "users",
    secret: "test-secret",
    roles: [
      {
        name: "reporter",
        permissions: [
          { name: "reports:*" },
          { name: "api-key:create" },
          { name: "api-key:read" },
        ],
      },
    ],
  });

  readReports = $action({
    path: "/scope/reports",
    use: [$secure({ permissions: ["reports:read"] })],
    schema: { response: z.text() },
    handler: () => "READ",
  });

  exportReports = $action({
    method: "POST",
    path: "/scope/reports/export",
    use: [$secure({ permissions: ["reports:export"] })],
    schema: { response: z.text() },
    handler: () => "EXPORTED",
  });

  danger = $permission({ group: "danger", name: "delete" });
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaOrmPostgres)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiKeys);
  const app = alepha.inject(TestApp);
  const service = alepha.inject(ApiKeyService);
  const controller = alepha.inject(ApiKeyController);
  await alepha.start();
  app.issuer.registerResolver(service.createResolver());

  const { hostname } = alepha.inject(ServerProvider);
  const userId = randomUUID();
  const reporter: UserAccountToken = {
    id: userId,
    realm: "users",
    roles: ["reporter"],
  };

  const call = (method: string, path: string, token: string) =>
    fetch(`${hostname}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });

  return { app, service, controller, userId, reporter, call };
};

describe("an API key's permission scope", () => {
  it("leaves an existing key with an empty column exactly as it was", async () => {
    const { app, service, userId, call } = await setup();

    const { apiKey, token } = await service.create({
      userId,
      name: "legacy",
      roles: ["reporter"],
    });
    expect((await app.keys.getById(apiKey.id)).permissions).toEqual([]);

    const identity = await service.validate(token);
    expect(identity).not.toBeNull();
    expect(identity?.permissionScope).toBeUndefined();

    expect((await call("GET", "/api/scope/reports", token)).status).toBe(200);
    expect(
      (await call("POST", "/api/scope/reports/export", token)).status,
    ).toBe(200);
  });

  it("refuses a scoped key a permission its roles do grant", async () => {
    const { service, userId, reporter, call } = await setup();

    const { token } = await service.create({
      userId,
      name: "read only",
      roles: ["reporter"],
      permissions: ["reports:read"],
      caller: reporter,
    });

    expect((await service.validate(token))?.permissionScope).toEqual([
      "reports:read",
    ]);
    expect((await call("GET", "/api/scope/reports", token)).status).toBe(200);

    const refused = await call("POST", "/api/scope/reports/export", token);
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain("permission scope");
  });

  it("refuses at creation a permission beyond the caller, naming it", async () => {
    const { service, userId, reporter } = await setup();

    await expect(
      service.create({
        userId,
        name: "too wide",
        roles: ["reporter"],
        permissions: ["reports:read", "danger:delete"],
        caller: reporter,
      }),
    ).rejects.toThrow("'danger:delete'");
  });

  it("measures the ceiling against the caller's own scope, not only its roles", async () => {
    const { service, userId, reporter } = await setup();

    await expect(
      service.create({
        userId,
        name: "wider than the caller",
        roles: ["reporter"],
        permissions: ["reports:export"],
        caller: { ...reporter, permissionScope: ["reports:read"] },
      }),
    ).rejects.toThrow("'reports:export'");
  });

  it("refuses a pattern and an unregistered name at creation", async () => {
    const { service, userId, reporter } = await setup();

    await expect(
      service.create({
        userId,
        name: "pattern",
        roles: ["reporter"],
        permissions: ["reports:*"],
        caller: reporter,
      }),
    ).rejects.toThrow("'reports:*' is a pattern");

    await expect(
      service.create({
        userId,
        name: "typo",
        roles: ["reporter"],
        permissions: ["reports:raed"],
        caller: reporter,
      }),
    ).rejects.toThrow("'reports:raed'");
  });

  it("refuses in the service, so action.run() is refused too, and serializes the scope", async () => {
    const { controller, reporter } = await setup();

    await expect(
      controller.createApiKey.run(
        { body: { name: "over run", permissions: ["danger:delete"] } },
        { user: reporter },
      ),
    ).rejects.toThrow("'danger:delete'");

    const created = await controller.createApiKey.run(
      { body: { name: "scoped over run", permissions: ["reports:read"] } },
      { user: reporter },
    );
    expect(created.permissions).toEqual(["reports:read"]);

    const listed = await controller.listApiKeys.run({}, { user: reporter });
    expect(listed.find((key) => key.id === created.id)?.permissions).toEqual([
      "reports:read",
    ]);
  });

  it("keeps the scope through a rotation", async () => {
    const { service, userId, reporter } = await setup();

    const { apiKey } = await service.create({
      userId,
      name: "rotated",
      roles: ["reporter"],
      permissions: ["reports:read"],
      caller: reporter,
    });
    const rotated = await service.rotate(apiKey.id, userId);

    expect(rotated.apiKey.permissions).toEqual(["reports:read"]);
    expect((await service.validate(rotated.token))?.permissionScope).toEqual([
      "reports:read",
    ]);
  });
});
