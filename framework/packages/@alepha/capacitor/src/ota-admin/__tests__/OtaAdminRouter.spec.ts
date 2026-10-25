import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Alepha } from "alepha";
import { AlephaReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

import { otaAdminEn } from "../i18n/otaAdminEn.ts";
import { otaAdminFr } from "../i18n/otaAdminFr.ts";
import { OtaAdminRouter } from "../OtaAdminRouter.ts";

const mount = async () => {
  const alepha = Alepha.create().with(AlephaReactRouter);
  const router = alepha.inject(OtaAdminRouter);
  await alepha.start();
  return { alepha, router };
};

describe("OtaAdminRouter", () => {
  it("hides the pages unless the server offers the OTA actions", async ({
    expect,
  }) => {
    const { alepha, router } = await mount();

    // A wildcard admin holds every permission-shaped name: the permission
    // alone never shows the entry, the action must exist.
    alepha.store.set("alepha.server.request.apiLinks", { actions: {} });
    expect(router.otaApps.options.can!({ has: () => true })).toBe(false);
    expect(router.otaApp.options.can!({ has: () => true })).toBe(false);

    alepha.store.set("alepha.server.request.apiLinks", {
      actions: {
        otaListApps: { path: "/ota/apps" },
        otaGetApp: { path: "/ota/apps/:id" },
      },
    });
    expect(router.otaApps.options.can!({ has: () => true })).toBe(true);
    expect(router.otaApp.options.can!({ has: () => true })).toBe(true);
  });

  it("lives under /admin/ota in its own nav group, translated", async ({
    expect,
  }) => {
    const { alepha } = await mount();
    const nav = alepha
      .primitives("page" as never)
      .map((page: any) => page.options.nav)
      .find((it: any) => it?.labelKey === "ota.admin.nav");
    expect(nav).toMatchObject({
      group: "Live updates",
      groupKey: "ota.admin.navGroup",
    });
  });

  it("has a French value for every key the pages use", ({ expect }) => {
    const dir = join(import.meta.dirname, "..", "components");
    const used = new Set<string>();
    for (const file of readdirSync(dir)) {
      for (const match of readFileSync(join(dir, file), "utf-8").matchAll(
        /tr\(\s*"(ota\.admin\.[^"]+)"/g,
      )) {
        used.add(match[1]);
      }
    }
    expect(used.size).toBeGreaterThan(50);
    for (const key of used) {
      expect(otaAdminEn[key], key).toBeTruthy();
      expect(otaAdminFr[key], key).toBeTruthy();
    }
    expect(Object.keys(otaAdminFr).sort()).toEqual(
      Object.keys(otaAdminEn).sort(),
    );
  });
});
