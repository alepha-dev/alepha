import { Alepha } from "alepha";
import { DbEntityNotFoundError } from "alepha/orm";
import { $issuer, AlephaSecurity } from "alepha/security";
import { describe, it } from "vitest";
import { AlephaApiClients } from "../index.ts";
import { OAuth2Service } from "../services/OAuth2Service.ts";
import { AdminOAuthClientController } from "./AdminOAuthClientController.ts";

const setup = async () => {
  class TestApp {
    issuer = $issuer({
      secret: "test-secret-admin-ctrl",
      roles: [
        { name: "admin", permissions: [{ name: "*" }] },
        {
          name: "user",
          permissions: [{ name: "profile:read" }, { name: "items:read" }],
        },
      ],
    });
  }

  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaSecurity)
    .with(AlephaApiClients);

  const app = alepha.inject(TestApp);
  const controller = alepha.inject(AdminOAuthClientController);
  const service = alepha.inject(OAuth2Service);

  await alepha.start();

  service.issuer = app.issuer;
  service.realmName = app.issuer.name;

  return { alepha, controller, service };
};

describe("AdminOAuthClientController", () => {
  it("should create a client", async ({ expect }) => {
    const { controller } = await setup();

    const result = await controller.createClient({
      body: {
        name: "Test Client",
        redirectUris: ["http://localhost:3000/callback"],
        grantTypes: ["authorization_code"],
        scopes: ["profile:read"],
      },
    });

    expect(result.clientId).toBeTruthy();
    expect(result.clientSecret).toBeTruthy();
    expect(result.clientSecret).toMatch(/^cs_/);
    expect(result.name).toBe("Test Client");
    expect(result.redirectUris).toEqual(["http://localhost:3000/callback"]);
    expect(result.grantTypes).toEqual(["authorization_code"]);
    expect(result.scopes).toEqual(["profile:read"]);
    expect(result.tokenEndpointAuthMethod).toBe("client_secret_basic");
    expect(result.firstParty).toBe(false);
    expect(result.createdAt).toBeDefined();
  });

  it("should create a public client", async ({ expect }) => {
    const { controller } = await setup();

    const result = await controller.createClient({
      body: {
        name: "Public SPA Client",
        redirectUris: ["http://localhost:3000/callback"],
        tokenEndpointAuthMethod: "none",
      },
    });

    expect(result.clientId).toBeTruthy();
    expect(result.clientSecret).toBeUndefined();
    expect(result.tokenEndpointAuthMethod).toBe("none");
  });

  it("should create a first-party client", async ({ expect }) => {
    const { controller } = await setup();

    const result = await controller.createClient({
      body: {
        name: "First Party App",
        redirectUris: ["http://localhost:3000/callback"],
        firstParty: true,
      },
    });

    expect(result.firstParty).toBe(true);
  });

  it("should get a client by ID", async ({ expect }) => {
    const { controller } = await setup();

    const created = await controller.createClient({
      body: {
        name: "Get Me Client",
        redirectUris: ["http://localhost:3000/callback"],
      },
    });

    const result = await controller.getClient({
      params: { id: created.id },
    });

    expect(result.id).toBe(created.id);
    expect(result.name).toBe("Get Me Client");
    expect(result.clientId).toBe(created.clientId);
    expect(result.enabled).toBe(true);
  });

  it("should throw for non-existent client", async ({ expect }) => {
    const { controller } = await setup();

    await expect(
      controller.getClient({
        params: { id: "550e8400-e29b-41d4-a716-446655440000" },
      }),
    ).rejects.toThrowError(DbEntityNotFoundError);
  });

  it("should disable a client", async ({ expect }) => {
    const { controller } = await setup();

    const created = await controller.createClient({
      body: {
        name: "Disable Me Client",
        redirectUris: ["http://localhost:3000/callback"],
      },
    });

    const result = await controller.disableClient({
      params: { id: created.id },
    });

    expect(result.ok).toBe(true);
    expect(result.id).toBe(created.id);

    // Verify client is disabled
    const updated = await controller.getClient({
      params: { id: created.id },
    });
    expect(updated.enabled).toBe(false);
  });

  it("should list clients with pagination", async ({ expect }) => {
    const { controller } = await setup();

    await controller.createClient({
      body: {
        name: "Client A",
        redirectUris: ["http://localhost:3000/callback"],
      },
    });
    await controller.createClient({
      body: {
        name: "Client B",
        redirectUris: ["http://localhost:3000/callback"],
      },
    });
    await controller.createClient({
      body: {
        name: "Client C",
        redirectUris: ["http://localhost:3000/callback"],
      },
    });

    const result = await controller.findClients({ query: {} });

    expect(result.content.length).toBeGreaterThanOrEqual(3);
    expect(result.page.totalElements).toBeGreaterThanOrEqual(3);
  });

  it("should filter clients by firstParty", async ({ expect }) => {
    const { controller } = await setup();

    await controller.createClient({
      body: {
        name: "First Party",
        redirectUris: ["http://localhost:3000/callback"],
        firstParty: true,
      },
    });
    await controller.createClient({
      body: {
        name: "Third Party",
        redirectUris: ["http://localhost:3000/callback"],
        firstParty: false,
      },
    });

    const firstPartyResult = await controller.findClients({
      query: { firstParty: true },
    });
    expect(firstPartyResult.content.every((c) => c.firstParty === true)).toBe(
      true,
    );

    const thirdPartyResult = await controller.findClients({
      query: { firstParty: false },
    });
    expect(thirdPartyResult.content.every((c) => c.firstParty === false)).toBe(
      true,
    );
  });

  it("should filter clients by enabled status", async ({ expect }) => {
    const { controller } = await setup();

    const created = await controller.createClient({
      body: {
        name: "To Disable",
        redirectUris: ["http://localhost:3000/callback"],
      },
    });

    await controller.disableClient({ params: { id: created.id } });

    const enabledResult = await controller.findClients({
      query: { enabled: true },
    });
    expect(enabledResult.content.every((c) => c.enabled === true)).toBe(true);

    const disabledResult = await controller.findClients({
      query: { enabled: false },
    });
    expect(disabledResult.content.some((c) => c.id === created.id)).toBe(true);
    expect(disabledResult.content.every((c) => c.enabled === false)).toBe(true);
  });
});
