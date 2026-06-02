import { Alepha } from "alepha";
import { RootComponentsProvider as PublicRootComponentsProvider } from "alepha/react/router";
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

  it("is exported from the public alepha/react/router entry", () => {
    const alepha = Alepha.create();
    const provider = alepha.inject(PublicRootComponentsProvider);
    expect(Array.isArray(provider.rootComponents)).toBe(true);
  });
});
