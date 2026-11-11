import { $hook, $inject, $module, Alepha, z } from "alepha";
import { $secure, AlephaSecurity } from "alepha/security";
import { $action, $route } from "alepha/server";
import { AlephaServerLinks } from "alepha/server/links";
import { describe, it } from "vitest";

import { AppSurfaceCollector } from "../services/AppSurfaceCollector.ts";

class QuestApi {
  list = $action({
    method: "GET",
    path: "/quests",
    use: [$secure({ permissions: ["quest:read"] })],
    handler: () => "",
  });
  upload = $action({
    method: "POST",
    path: "/quests/:id/file",
    schema: { body: z.object({ file: z.file() }) },
    handler: () => "",
  });
}

class Hooked {
  feed = $route({ method: "GET", path: "/feed", handler: () => "" });
  boot = $hook({ on: "start", handler: () => {} });
}

class UsesApi {
  api = $inject(QuestApi);
}

const collect = (alepha: Alepha) =>
  alepha.inject(AppSurfaceCollector).collect(alepha);

describe("AppSurfaceCollector", () => {
  it("lists each class by module and name, with its purity", ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaSecurity)
      .with($module({ name: "acme.api", services: [QuestApi, Hooked] }));
    const surface = collect(alepha);

    expect(surface.classes).toEqual(
      expect.arrayContaining([
        {
          key: "acme.api:QuestApi",
          pure: true,
          permissions: ["quest:read"],
        },
        { key: "acme.api:Hooked", pure: false, reasons: ["holds a $hook"] },
      ]),
    );
  });

  it("stores action paths without the API prefix, with secured and the body type", ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaSecurity)
      .with(AlephaServerLinks)
      .with($module({ name: "acme.api", services: [QuestApi] }));
    const surface = collect(alepha);

    expect(surface.actions).toEqual(
      expect.arrayContaining([
        {
          name: "list",
          group: "QuestApi",
          method: "GET",
          path: "/quests",
          secured: { permissions: ["quest:read"] },
          class: "acme.api:QuestApi",
        },
        expect.objectContaining({
          name: "upload",
          method: "POST",
          path: "/quests/:id/file",
          contentType: "multipart/form-data",
        }),
      ]),
    );
  });

  it("lists routes by class, a class no module lists by its name alone", ({
    expect,
  }) => {
    class Feed {
      rss = $route({ method: "GET", path: "/rss", handler: () => "" });
    }
    const alepha = Alepha.create().with(Feed);
    expect(collect(alepha).routes).toContainEqual({
      method: "GET",
      path: "/rss",
      class: "Feed",
    });
  });

  it("makes both classes not pure when two share a key", ({ expect }) => {
    const first = (() => {
      return class Twin {
        a = $action({ method: "GET", path: "/a", handler: () => "" });
      };
    })();
    const second = (() => {
      return class Twin {
        b = $action({ method: "GET", path: "/b", handler: () => "" });
      };
    })();
    const alepha = Alepha.create().with(first).with(second);
    const twins = collect(alepha).classes.filter((it) => it.key === "Twin");

    expect(twins).toHaveLength(2);
    for (const twin of twins) {
      expect(twin.pure).toBe(false);
      expect(twin.reasons).toContain("name is not unique");
    }
  });

  it("reports the pure count and names each controller that is not pure", ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaSecurity)
      .with($module({ name: "acme.api", services: [QuestApi] }))
      .with(UsesApi);
    const collector = alepha.inject(AppSurfaceCollector);

    expect(collector.report(collector.collect(alepha))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\d+ of \d+ controllers are pure$/),
        "  acme.api:QuestApi: injected by UsesApi",
      ]),
    );
  });
});
