import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { $head } from "../primitives/$head.ts";
import { HeadProvider } from "../providers/HeadProvider.ts";

/**
 * `$head({ afterPages })`: a head computed once every page's own has merged,
 * from the matched layers. A layout drawing a breadcrumb from shared state
 * uses it to make the title follow the same trail.
 */
describe("$head({ afterPages })", () => {
  const layer = (
    name: string,
    head?: (props: any, previous?: any) => any,
    params?: Record<string, string>,
  ) => ({
    name,
    config: { params },
    route: head ? { head } : undefined,
  });

  it("runs after the page heads and wins over the deepest one", ({
    expect,
  }) => {
    const seen: unknown[] = [];
    class Titles {
      head = $head({
        afterPages: ({ head, layers }) => {
          seen.push({ title: head.title, names: layers.map((it) => it.name) });
          const page = layers[layers.length - 1];
          return { title: `Acme › Hosts › ${page?.params?.hostSlug}` };
        },
      });
    }
    const alepha = Alepha.create().with(Titles);
    const provider = alepha.inject(HeadProvider);
    const state = {
      head: {},
      layers: [
        layer("project", () => ({ title: "Acme" })),
        layer(
          "bayOverview",
          (_props, previous) => ({ title: `${previous?.title} › Overview` }),
          { hostSlug: "ovh" },
        ),
      ],
    };

    provider.fillHead(state as any);

    expect((state.head as any).title).toBe("Acme › Hosts › ovh");
    // It saw what the pages had left, and every layer in order.
    expect(seen).toEqual([
      { title: "Acme › Overview", names: ["project", "bayOverview"] },
    ]);
  });

  it("leaves the pages' head alone when it returns undefined", ({ expect }) => {
    class Titles {
      head = $head({ afterPages: () => undefined });
    }
    const alepha = Alepha.create().with(Titles);
    const provider = alepha.inject(HeadProvider);
    const state = {
      head: {},
      layers: [layer("home", () => ({ title: "Home" }))],
    };

    provider.fillHead(state as any);

    expect((state.head as any).title).toBe("Home");
  });

  it("is not a global entry: the early head never runs it", ({ expect }) => {
    class Titles {
      head = $head({ afterPages: () => ({ title: "late" }) });
    }
    const alepha = Alepha.create().with(Titles);
    const provider = alepha.inject(HeadProvider);

    expect(provider.global ?? []).toHaveLength(0);
    expect(provider.resolveGlobal().title).toBeUndefined();
  });
});
