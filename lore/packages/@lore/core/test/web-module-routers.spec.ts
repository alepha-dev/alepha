import {
  AutomationRouter,
  CoreRouter,
  LoreAccountRouter,
  LoreCoreWeb,
} from "@lore/core/web";
import { Alepha } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

/**
 * `LoreCoreWeb` registers its routers in `register`, never in `services`
 * (#Q3417): a listed class is tagged with the module, and creating it
 * anywhere would then register the whole module and its page tree. They are
 * registered with `alepha.with` since, which tags nothing either and lets a
 * build list declare a pure router without creating it.
 */
describe("LoreCoreWeb's routers", () => {
  it("creating one router does not boot the module's page tree", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });
    alepha.with(AlephaReactRouter).with(AlephaReactI18n);
    alepha.inject(CoreRouter);

    expect(alepha.has(LoreCoreWeb)).toBe(false);
    expect(alepha.has(AutomationRouter)).toBe(false);
    expect(alepha.has(LoreAccountRouter)).toBe(false);
  });

  it("registering the module creates every router", ({ expect }) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });
    alepha.with(LoreCoreWeb);

    for (const router of [CoreRouter, AutomationRouter, LoreAccountRouter]) {
      expect(alepha.has(router), router.name).toBe(true);
    }
  });
});
