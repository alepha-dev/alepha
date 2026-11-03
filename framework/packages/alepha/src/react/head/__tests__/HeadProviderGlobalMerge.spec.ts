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

    provider.fillHead(state);

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

    provider.fillHead(state);

    expect((state.head as any).htmlAttributes).toEqual({ lang: "es" });
  });

  it("lets a page's description replace the global one", () => {
    const provider = createProvider();
    provider.global = [{ title: "Site", description: "The tagline" }];
    const state = {
      head: {},
      layers: [{ route: { head: { description: "The page" } } }],
    };

    provider.fillHead(state);

    const meta: any[] = (state.head as any).meta;
    const contents = (key: string) =>
      meta
        .filter((it) => it.name === key || it.property === key)
        .map((it) => it.content);
    expect(contents("description")).toEqual(["The page"]);
    expect(contents("og:description")).toEqual(["The page"]);
    expect(contents("twitter:description")).toEqual(["The page"]);
    expect(contents("og:title")).toEqual(["Site"]);
  });

  it("merges bodyAttributes across global heads", () => {
    const provider = createProvider();
    provider.global = [
      { bodyAttributes: { class: "app" } },
      { bodyAttributes: { "data-route": "home" } },
    ];
    const state = emptyState();

    provider.fillHead(state);

    expect((state.head as any).bodyAttributes).toEqual({
      class: "app",
      "data-route": "home",
    });
  });
});
