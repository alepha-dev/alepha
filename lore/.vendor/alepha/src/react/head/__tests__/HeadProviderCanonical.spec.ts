import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { HeadProvider } from "../providers/HeadProvider.ts";

/**
 * `head.url` drives `<link rel="canonical">`, `og:url` and `twitter:url` in
 * SeoExpander, and nothing ever set it — so pages shipped OpenGraph tags with
 * no `og:url` and no canonical at all. It is filled here, from the matched
 * route path rather than the request URL.
 */
describe("HeadProvider canonical URL", () => {
  const createProvider = (env: Record<string, unknown> = {}) => {
    const alepha = Alepha.create({
      env: { PUBLIC_URL: "https://alepha.dev", ...env },
    });
    return alepha.inject(HeadProvider);
  };

  const stateFor = (path: string | undefined, head: any = {}) => ({
    head,
    layers: [
      { path: "", route: {} },
      { path, route: {} },
    ],
  });

  const linksOf = (state: any) =>
    (state.head.link ?? []).filter((l: any) => l.rel === "canonical");

  it("names the page's own URL, from PUBLIC_URL and the matched path", () => {
    const provider = createProvider();
    const state = stateFor("/docs/getting-started");

    provider.fillHead(state as any);

    expect(state.head.url).toBe("https://alepha.dev/docs/getting-started");
    expect(linksOf(state)).toEqual([
      { rel: "canonical", href: "https://alepha.dev/docs/getting-started" },
    ]);
    // The same `url` is what OpenGraph and Twitter were missing.
    expect(state.head.meta).toContainEqual({
      property: "og:url",
      content: "https://alepha.dev/docs/getting-started",
    });
  });

  it("maps the root path to a single trailing slash", () => {
    const provider = createProvider();
    const state = stateFor("");

    provider.fillHead(state as any);

    expect(state.head.url).toBe("https://alepha.dev/");
  });

  it("does not double the origin's trailing slash", () => {
    const provider = createProvider({ PUBLIC_URL: "https://alepha.dev/" });
    const state = stateFor("/changelog");

    provider.fillHead(state as any);

    expect(state.head.url).toBe("https://alepha.dev/changelog");
  });

  /**
   * The reason this is filled from the route path and not from the request
   * URL. A canonical carrying `?utm_source=…` makes the tracked link its own
   * authoritative page — it certifies the duplication it exists to collapse.
   */
  it("carries no query string, because the route path has none", () => {
    const provider = createProvider();
    const state = stateFor("/changelog");

    provider.fillHead(state as any);

    expect(state.head.url).not.toContain("?");
  });

  it("leaves an author's own url alone, and emits exactly one canonical", () => {
    const provider = createProvider();
    const state: any = {
      head: {},
      layers: [
        { path: "", route: {} },
        {
          path: "/docs/old-slug",
          route: { head: () => ({ url: "https://alepha.dev/docs/new-slug" }) },
        },
      ],
    };

    provider.fillHead(state as any);

    expect(state.head.url).toBe("https://alepha.dev/docs/new-slug");
    expect(linksOf(state)).toEqual([
      { rel: "canonical", href: "https://alepha.dev/docs/new-slug" },
    ]);
  });

  it("says nothing for a wildcard route, which has no single URL", () => {
    const provider = createProvider();
    const state = stateFor("/*");

    provider.fillHead(state as any);

    expect(state.head.url).toBeUndefined();
    expect(linksOf(state)).toEqual([]);
  });

  it("says nothing for /404", () => {
    const provider = createProvider();
    const state = stateFor("/404");

    provider.fillHead(state as any);

    expect(state.head.url).toBeUndefined();
  });

  /**
   * The page being shown is not the page that was asked for, so it must not
   * claim to be the authoritative version of that URL.
   */
  it("says nothing when a layer errored", () => {
    const provider = createProvider();
    const state: any = {
      head: {},
      layers: [
        { path: "", route: {} },
        { path: "/docs/x", route: {}, error: new Error("boom") },
      ],
    };

    provider.fillHead(state as any);

    expect(state.head.url).toBeUndefined();
  });

  /**
   * A relative canonical resolves against whichever host served it — which is
   * exactly the set of hosts a canonical exists to disambiguate.
   */
  it("says nothing with no origin to build on", () => {
    const provider = createProvider({ PUBLIC_URL: "" });
    const state = stateFor("/changelog");

    provider.fillHead(state as any);

    expect(state.head.url).toBeUndefined();
    expect(linksOf(state)).toEqual([]);
  });
});
