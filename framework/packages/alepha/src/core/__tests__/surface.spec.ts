import { Alepha, type AppSurface } from "alepha";
import { describe, it } from "vitest";

const empty: AppSurface = {
  version: 1,
  classes: [],
  actions: [],
  routes: [],
  pages: [],
  jobs: [],
  tools: [],
  resources: [],
  prompts: [],
};

describe("Alepha.surface", () => {
  it("has no build list outside a built bundle", ({ expect }) => {
    expect(Alepha.create().surface).toBeUndefined();
  });

  it("takes one handed over explicitly, and lets it go", ({ expect }) => {
    const alepha = Alepha.create().useSurface(empty);
    expect(alepha.surface).toBe(empty);
    expect(alepha.useSurface(undefined).surface).toBeUndefined();
  });
});
