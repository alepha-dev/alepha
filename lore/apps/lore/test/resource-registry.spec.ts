import { Alepha } from "alepha";
import { AlephaOrm } from "alepha/orm";
import { describe, it } from "vitest";

import { ResourceRegistry } from "../src/api/resources/ResourceRegistry.ts";
import { ResourceLinkService } from "../src/api/services/ResourceLinkService.ts";

/**
 * Core's registry of linkable resources (#E75, #Q2610): the modules register
 * their kinds, and core resolves references, search and cross-module actions
 * through it. What these pin is the behaviour of a kind no module
 * registered, which is the case the registry exists to make survivable.
 */
describe("ResourceRegistry", () => {
  const kind = (name: string, letter?: string, order = 10) => ({
    kind: name,
    letter,
    order,
    permission: `${name}:read`,
  });

  it("refuses a kind or a letter registered twice", ({ expect }) => {
    const registry = Alepha.create().inject(ResourceRegistry);
    registry.register(kind("quest", "Q"));

    expect(() => registry.register(kind("quest"))).toThrow(/twice/);
    expect(() => registry.register(kind("quiz", "Q"))).toThrow(
      /claimed by both/,
    );
  });

  it("reads a reference only for a letter some module registered", ({
    expect,
  }) => {
    const registry = Alepha.create().inject(ResourceRegistry);
    registry.register(kind("folio", "F"));

    expect(registry.parseReference("#f12")).toEqual({
      kind: "folio",
      number: 12,
    });
    expect(registry.parseReference("#Q12")).toBeUndefined();
    expect(registry.parseReference("#F12#anchor")).toBeUndefined();
  });

  it("refuses an action needing an absent kind, naming it", ({ expect }) => {
    const registry = Alepha.create().inject(ResourceRegistry);

    expect(registry.get("quest")).toBeUndefined();
    expect(() =>
      registry.require("quest", "forward a blight into a quest"),
    ).toThrow(
      "Cannot forward a blight into a quest: no module registers the 'quest' resource here",
    );
  });

  it("orders kinds by their order, not by registration", ({ expect }) => {
    const registry = Alepha.create().inject(ResourceRegistry);
    registry.register(kind("feedback", "P", 60));
    registry.register(kind("quest", "Q", 10));
    registry.register(kind("folio", "F", 20));

    expect(registry.all().map((it) => it.kind)).toEqual([
      "quest",
      "folio",
      "feedback",
    ]);
  });

  it("runs every deletion subscriber, and accepts one for an absent kind", async ({
    expect,
  }) => {
    const registry = Alepha.create().inject(ResourceRegistry);
    const seen: string[] = [];
    registry.onDeleted("quest", async (event) => {
      seen.push(`a:${event.id}`);
    });
    registry.onDeleted("quest", async (event) => {
      seen.push(`b:${event.id}`);
    });

    await registry.deleted({ kind: "quest", id: 7, projectId: 1, row: {} });
    await registry.deleted({ kind: "epic", id: 8, projectId: 1, row: {} });

    expect(seen).toEqual(["a:7", "b:7"]);
  });

  it("writes no link for a letter no module registered", async ({ expect }) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    }).with(AlephaOrm);
    const links = alepha.inject(ResourceLinkService);
    alepha.inject(ResourceRegistry).register(kind("folio", "F"));
    await alepha.start();

    expect(links.parseTokens("[[#Q12]] and [[#F3]]")).toEqual([
      { type: "folio", id: 3, raw: "#F3" },
    ]);
    expect(await links.describe("quest", 1, ["12"])).toEqual([]);

    await alepha.stop();
  });
});
