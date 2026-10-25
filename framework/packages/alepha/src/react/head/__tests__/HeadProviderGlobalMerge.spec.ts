import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { HeadProvider } from "../providers/HeadProvider.ts";

/**
 * Global `$head` entries each contribute attributes to `<html>` and `<body>`:
 * i18n reports `lang`, an app adds its theme. `fillHead` (what the browser
 * applies on every navigation) must merge them the way `resolveGlobalHead`
 * (the server's early head) does, or the two disagree and `lang` falls back
 * to "en" in the browser.
 */
describe("HeadProvider global head merge", () => {
  const createProvider = () => {
    const alepha = Alepha.create();
    return alepha.inject(HeadProvider);
  };

  const emptyState = () => ({ head: {}, layers: [] as any[] });

  it("keeps an earlier global head's lang when a later one sets other htmlAttributes", () => {
    const provider = createProvider();
    provider.global = [
      () => ({ htmlAttributes: { lang: "fr" } }),
      () => ({ htmlAttributes: { "data-theme": "portal" } }),
    ];
    const state = emptyState();

    provider.fillHead(state as any);

    expect(state.head).toMatchObject({
      htmlAttributes: { lang: "fr", "data-theme": "portal" },
    });
    expect(provider.resolveGlobalHead().htmlAttributes).toEqual(
      (state.head as any).htmlAttributes,
    );
  });

  it("lets a later global head override the same htmlAttribute", () => {
    const provider = createProvider();
    provider.global = [
      { htmlAttributes: { lang: "fr" } },
      { htmlAttributes: { lang: "es" } },
    ];
    const state = emptyState();

    provider.fillHead(state as any);

    expect((state.head as any).htmlAttributes).toEqual({ lang: "es" });
  });

  it("merges bodyAttributes across global heads", () => {
    const provider = createProvider();
    provider.global = [
      { bodyAttributes: { class: "app" } },
      { bodyAttributes: { "data-route": "home" } },
    ];
    const state = emptyState();

    provider.fillHead(state as any);

    expect((state.head as any).bodyAttributes).toEqual({
      class: "app",
      "data-route": "home",
    });
  });
});
