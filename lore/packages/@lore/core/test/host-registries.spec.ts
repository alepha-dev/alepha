import { Alepha } from "alepha";
import { Rocket } from "lucide-react";
import { describe, it } from "vitest";

import type { Host } from "../src/api/entities/hosts.ts";
import { HostCommandHandlerRegistry } from "../src/api/services/HostCommandHandlerRegistry.ts";
import { HostTypeRegistry } from "../src/api/services/HostTypeRegistry.ts";
import { HostUsageRegistry } from "../src/api/services/HostUsageRegistry.ts";
import { HostRoleRegistry } from "../src/web/app/registries/HostRoleRegistry.ts";

/**
 * Core's host registries (#E166, #Q4098): what a module tells core about a
 * host it does not own. Each answers sensibly with nothing registered, and
 * answers what a module said once one is.
 */
describe("host registries", () => {
  const host = { id: "h1", type: "cloudflare" } as unknown as Host;
  const user = { id: "u1", roles: ["user"] } as any;

  it("usage: empty answers nothing, filled answers every reader", async ({
    expect,
  }) => {
    const usage = Alepha.create().inject(HostUsageRegistry);
    expect(await usage.references("h1")).toEqual([]);
    expect(await usage.trackedApps("h1")).toEqual([]);

    usage.registerReferences(async (hostId, projectId) =>
      projectId === undefined ? [`acme/production on ${hostId}`] : [],
    );
    usage.registerReferences(async () => ["site (stack)"]);
    usage.registerTrackedApps(async () => [
      { id: "i1", app: "acme", env: "production", projectId: 1 },
    ]);
    expect(await usage.references("h1")).toEqual([
      "acme/production on h1",
      "site (stack)",
    ]);
    expect(await usage.references("h1", 2)).toEqual(["site (stack)"]);
    expect(await usage.trackedApps("h1")).toHaveLength(1);
  });

  it("types: empty has no status nor mask and refuses a check, filled delegates", async ({
    expect,
  }) => {
    const types = Alepha.create().inject(HostTypeRegistry);
    expect(types.credentialStatus(host)).toBeUndefined();
    expect(types.mask("cloudflare", "cfat_secret")).toBeUndefined();
    await expect(
      types.check("cloudflare", { accountId: "a", token: "t" }),
    ).rejects.toThrow(/no credential/);

    types.register("cloudflare", {
      credentialStatus: () => "valid",
      mask: (token) => token.slice(0, 4),
      check: async () => ({ outcome: "passed" }),
      recheck: async () => ({ outcome: "inconclusive", message: "later" }),
    });
    expect(types.has("cloudflare")).toBe(true);
    expect(types.credentialStatus(host)).toBe("valid");
    expect(types.mask("cloudflare", "cfat_secret")).toBe("cfat");
    expect(
      await types.check("cloudflare", { accountId: "a", token: "t" }),
    ).toEqual({ outcome: "passed" });
    expect((await types.recheck(host)).outcome).toBe("inconclusive");
    expect(() => types.register("cloudflare", {} as any)).toThrow(/already/);
  });

  it("command handlers: an unregistered kind is a 400, a registered one is dispatched", async ({
    expect,
  }) => {
    const handlers = Alepha.create().inject(HostCommandHandlerRegistry);
    await expect(
      handlers.enqueue({ host, body: { kind: "restart" }, user }),
    ).rejects.toThrow(/cannot send a host a "restart" command/);

    const seen: string[] = [];
    handlers.register(["restart", "logs"], async (input) => {
      seen.push(input.body.kind);
      return { id: "c1" } as any;
    });
    expect(handlers.has("logs")).toBe(true);
    expect(handlers.has("upgrade")).toBe(false);
    await handlers.enqueue({ host, body: { kind: "logs" }, user });
    expect(seen).toEqual(["logs"]);
    expect(() =>
      handlers.register(["restart"], async () => ({}) as any),
    ).toThrow(/already/);
  });

  it("roles: core's stats and agent, then a module's, in order", ({
    expect,
  }) => {
    const roles = new HostRoleRegistry();
    expect(roles.of({ type: "bay" }).map((it) => it.key)).toEqual(["stats"]);
    expect(roles.of({ type: "cloudflare" })).toEqual([]);

    const filled = new HostRoleRegistry();
    filled.register({
      key: "deploy",
      order: 20,
      icon: Rocket,
      applies: (it) => it.deployAllowed === true,
      label: () => "deploy",
    });
    expect(
      filled
        .of({ type: "bay", deployAllowed: true, agent: "default" })
        .map((it) => it.key),
    ).toEqual(["stats", "deploy", "agent"]);
    expect(() =>
      filled.register({
        key: "ci",
        order: 40,
        icon: Rocket,
        applies: () => true,
        label: () => "ci",
      }),
    ).toThrow(/after the roles were first read/);
  });
});
