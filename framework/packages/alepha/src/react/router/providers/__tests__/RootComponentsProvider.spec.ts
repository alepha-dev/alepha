import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { RootComponentsProvider } from "../RootComponentsProvider.ts";

describe("RootComponentsProvider", () => {
  it("starts empty and accepts pushed nodes", () => {
    const alepha = Alepha.create();
    const provider = alepha.inject(RootComponentsProvider);
    expect(provider.rootComponents).toEqual([]);
    provider.rootComponents.push("x" as any);
    expect(alepha.inject(RootComponentsProvider).rootComponents).toHaveLength(
      1,
    );
  });
});
