import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { platformOptions } from "../atoms/platformOptions.ts";

describe("platformOptions", () => {
  it("refuses a wildcard domain at validation", ({ expect }) => {
    // The zone Route that served wildcard hosts is gone (#Q2482): a Custom
    // Domain is the only binding, and Cloudflare refuses a wildcard one at
    // deploy with a message naming nothing about this configuration.
    const alepha = Alepha.create();

    expect(() =>
      alepha.set(platformOptions, {
        environments: {
          production: { adapter: "cloudflare", domain: "*.club.alepha.dev" },
        },
      }),
    ).toThrow(/Lore Deploy/);
  });

  it("accepts a plain host", ({ expect }) => {
    const alepha = Alepha.create();

    alepha.set(platformOptions, {
      environments: {
        production: { adapter: "cloudflare", domain: "club.alepha.dev" },
      },
    });

    expect(alepha.store.get(platformOptions)?.environments.production).toEqual({
      adapter: "cloudflare",
      domain: "club.alepha.dev",
    });
  });
});
