import { Alepha } from "alepha";
import { MemoryDestinationProvider } from "alepha/logger";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";

import { AlephaOAuth, OAuthScopeResolver, oauthOptions } from "../index.ts";

const setup = async (
  scopes: Record<string, { label: string; permissions?: string[] }>,
) => {
  const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaOAuth);
  alepha.set(oauthOptions, { ...oauthOptions.options.default, scopes });
  await alepha.start();
  return {
    resolver: alepha.inject(OAuthScopeResolver),
    logs: alepha.inject(MemoryDestinationProvider).logs,
  };
};

describe("OAuthScopeResolver", () => {
  const declared = {
    projects: { label: "Projects", permissions: ["project:*", "quest:read"] },
    quests: { label: "Quests", permissions: ["quest:read", "quest:create"] },
    openid: { label: "Identity", permissions: [] },
    copyOnly: { label: "Copy only" },
  };

  it("unions the declared lists of every granted scope", async () => {
    const { resolver } = await setup(declared);

    expect(resolver.resolve(["projects", "quests"])).toEqual([
      "project:*",
      "quest:read",
      "quest:create",
    ]);
  });

  it("lets an identity scope contribute nothing", async () => {
    const { resolver } = await setup(declared);

    expect(resolver.resolve(["openid"])).toEqual([]);
    expect(resolver.resolve(["openid", "quests"])).toEqual([
      "quest:read",
      "quest:create",
    ]);
  });

  it("leaves the whole grant unrestricted when a DECLARED scope declares no permissions", async () => {
    const { resolver } = await setup(declared);

    expect(resolver.resolve(["quests", "copyOnly"])).toBeUndefined();
  });

  it("fails closed on a scope the application never declared (#Q2514)", async () => {
    const { resolver } = await setup(declared);

    // It used to leave the grant unrestricted: a self-registered client
    // asking for a made-up scope got the user's full roles.
    expect(resolver.resolve(["quests", "never-declared"])).toEqual([
      "quest:read",
      "quest:create",
    ]);
    expect(resolver.resolve(["never-declared"])).toEqual([]);
  });

  it("fails closed on a grant naming no scope, once scopes are declared (#Q2514)", async () => {
    const { resolver } = await setup(declared);

    expect(resolver.resolve([])).toEqual([]);
  });

  it("keeps an application that declares no scope unrestricted", async () => {
    const { resolver } = await setup({});

    expect(resolver.resolve([])).toBeUndefined();
    expect(resolver.resolve(["anything"])).toBeUndefined();
  });

  it("warns at boot about each declared scope that narrows nothing", async () => {
    const { logs } = await setup(declared);

    const warnings = logs
      .filter((entry) => entry.level === "WARN")
      .map((entry) => entry.message);
    expect(warnings.some((it) => it.includes("'copyOnly'"))).toBe(true);
    expect(warnings.some((it) => it.includes("'openid'"))).toBe(false);
    expect(warnings.some((it) => it.includes("'projects'"))).toBe(false);
  });
});
