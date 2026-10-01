import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import {
  $issuer,
  $permission,
  AlephaSecurity,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { ApiKeyController } from "../controllers/ApiKeyController.ts";
import { AlephaApiKeys } from "../index.ts";
import {
  type ApiKeyOptions,
  apiKeyOptions,
} from "../parameters/ApiKeyParameters.ts";

class TestApp {
  issuer = $issuer({
    name: "users",
    secret: "test-secret",
    roles: [
      { name: "admin", permissions: [{ name: "*" }] },
      {
        name: "reporter",
        permissions: [{ name: "reports:*" }, { name: "api-key:create" }],
      },
    ],
  });

  readReports = $permission({
    group: "reports",
    name: "read",
    label: "reports.read.label",
    description: "reports.read.description",
    groupLabel: "reports.group.label",
    groupOrder: 1,
  });

  exportReports = $permission({ group: "reports", name: "export" });

  deleteEverything = $permission({ group: "danger", name: "delete" });
}

const setup = async (options: Partial<ApiKeyOptions> = {}) => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiKeys);
  alepha.inject(TestApp);
  alepha.store.set(apiKeyOptions, {
    ...alepha.store.get(apiKeyOptions),
    ...options,
  });
  const controller = alepha.inject(ApiKeyController);
  const security = alepha.inject(SecurityProvider);
  await alepha.start();

  const options$ = (user: Partial<UserAccountToken>) =>
    controller.getApiKeyOptions.run(
      {},
      {
        user: { id: randomUUID(), realm: "users", ...user } as UserAccountToken,
      },
    );

  const names = (response: Awaited<ReturnType<typeof options$>>) =>
    response.permissions.groups
      .flatMap((group) => group.permissions.map((it) => it.name))
      .sort();

  return { security, options$, names };
};

describe("GET /api-keys/options", () => {
  describe("the permission ceiling", () => {
    it("never offers a permission the caller's roles do not grant, and names them in full", async () => {
      const { options$, names } = await setup();

      const response = await options$({ roles: ["reporter"] });

      expect(names(response)).toEqual([
        "api-key:create",
        "reports:export",
        "reports:read",
      ]);
      expect(names(response)).not.toContain("danger:delete");
    });

    it("gives a scoped caller its scope, not its roles' reach", async () => {
      const { options$, names } = await setup();

      // The endpoint itself needs `api-key:create`, so the scope holds it.
      const response = await options$({
        roles: ["reporter"],
        permissionScope: ["api-key:create", "reports:read"],
      });

      expect(names(response)).toEqual(["api-key:create", "reports:read"]);
    });

    it("expands a wildcard role to every permission the application declares", async () => {
      const { security, options$, names } = await setup();

      const response = await options$({ roles: ["admin"] });

      const everything = security
        .permissionCatalogueFor()
        .groups.flatMap((group) => group.permissions.map((it) => it.name))
        .sort();
      expect(names(response)).toEqual(everything);
      expect(names(response)).toContain("danger:delete");
    });

    it("returns labels as the raw translation keys they were declared with", async () => {
      const { options$ } = await setup();

      const response = await options$({ roles: ["reporter"] });
      const reports = response.permissions.groups.find(
        (group) => group.name === "reports",
      );

      expect(reports?.label).toBe("reports.group.label");
      expect(reports?.order).toBe(1);
      expect(
        reports?.permissions.find((it) => it.name === "reports:read"),
      ).toEqual({
        name: "reports:read",
        label: "reports.read.label",
        description: "reports.read.description",
      });
    });

    it("throws for a role the code no longer declares, as $secure does", async () => {
      const { security } = await setup();

      expect(() =>
        security.permissionCatalogueFor({
          roles: ["retired-role"],
          realm: "users",
        }),
      ).toThrow("retired-role");
    });
  });

  describe("the expiry policy", () => {
    it("offers every preset and the configured default while uncapped", async () => {
      const { options$ } = await setup();

      const { expiry } = await options$({ roles: ["reporter"] });

      expect(expiry).toEqual({
        default: "90d",
        maxDays: 0,
        presets: ["7d", "30d", "60d", "90d", "180d", "1y", "never"],
      });
    });

    it("shortens the presets to the cap, drops 'never', and preselects what the cap admits", async () => {
      const { options$ } = await setup({ maxExpiryDays: 60 });

      const { expiry } = await options$({ roles: ["reporter"] });

      expect(expiry.presets).toEqual(["7d", "30d", "60d"]);
      expect(expiry.maxDays).toBe(60);
      // The configured 90d would be refused, so the longest allowed preset.
      expect(expiry.default).toBe("60d");
    });
  });
});
