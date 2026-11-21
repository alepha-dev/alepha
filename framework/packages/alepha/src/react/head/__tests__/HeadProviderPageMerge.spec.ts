import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import type { Head } from "../interfaces/Head.ts";
import { HeadProvider } from "../providers/HeadProvider.ts";

/**
 * The server writes every tag of the filled head and the browser keeps one
 * tag per key, so the filled head itself must hold one tag per key: a later
 * tag replaces an earlier one, wherever each came from (a global head, a
 * page's SEO fields, a page's `meta` array, an `afterPages` head).
 */
describe("HeadProvider page head merge", () => {
  const fill = (
    global: Array<Head | (() => Head)>,
    pages: Head[],
    afterPages?: () => Head | undefined,
  ) => {
    const provider = Alepha.create().inject(HeadProvider);
    provider.global = global;
    if (afterPages) {
      provider.afterPages.push(afterPages);
    }
    const state: { head: Head; layers: any[] } = {
      head: {},
      layers: pages.map((head) => ({ route: { head } })),
    };
    provider.fillHead(state);
    return state.head;
  };

  const contents = (head: Head, key: string) =>
    (head.meta ?? [])
      .filter((it) => it.name === key || it.property === key)
      .map((it) => it.content);

  it("replaces a global meta tag with a page's explicit one of the same name", () => {
    const head = fill(
      [{ meta: [{ name: "robots", content: "index" }] }],
      [{ meta: [{ name: "robots", content: "noindex" }] }],
    );

    expect(contents(head, "robots")).toEqual(["noindex"]);
  });

  it("replaces a global meta tag with a later global one of the same name", () => {
    const head = fill(
      [
        { meta: [{ name: "robots", content: "index" }] },
        { meta: [{ name: "robots", content: "noindex" }] },
      ],
      [],
    );

    expect(contents(head, "robots")).toEqual(["noindex"]);
  });

  it("keeps one tag per key when an afterPages head sets SEO fields", () => {
    const head = fill([{ title: "Site", description: "Tagline" }], [], () => ({
      title: "Late",
      description: "Late desc",
    }));

    expect(contents(head, "description")).toEqual(["Late desc"]);
    expect(contents(head, "og:description")).toEqual(["Late desc"]);
    expect(contents(head, "og:title")).toEqual(["Late"]);
    expect(contents(head, "twitter:title")).toEqual(["Late"]);
    expect(contents(head, "twitter:description")).toEqual(["Late desc"]);
  });

  it("keeps two tags of one name apart by their media", () => {
    const light = {
      name: "theme-color",
      content: "#fff",
      media: "(prefers-color-scheme: light)",
    };
    const dark = {
      name: "theme-color",
      content: "#000",
      media: "(prefers-color-scheme: dark)",
    };
    const head = fill(
      [{ meta: [light, dark] }],
      [{ meta: [{ ...dark, content: "#111" }] }],
    );

    expect(head.meta).toEqual([light, { ...dark, content: "#111" }]);
  });

  it("keeps the repeated properties of one head, in order", () => {
    const meta = [
      { property: "og:image", content: "https://example.com/a.png" },
      { property: "og:image", content: "https://example.com/b.png" },
      { property: "article:tag", content: "one" },
      { property: "article:tag", content: "two" },
      { property: "og:locale:alternate", content: "fr_FR" },
      { property: "og:locale:alternate", content: "de_DE" },
    ];

    expect(fill([{ meta }], []).meta).toEqual(meta);
    expect(fill([], [{ meta }]).meta).toEqual(meta);
  });

  it("replaces every tag an earlier head declared for a key a later head declares", () => {
    const head = fill(
      [
        {
          meta: [
            { property: "og:image", content: "https://example.com/site.png" },
            { property: "article:tag", content: "site" },
          ],
        },
      ],
      [
        {
          meta: [
            { property: "og:image", content: "https://example.com/a.png" },
            { property: "og:image", content: "https://example.com/b.png" },
          ],
        },
      ],
    );

    expect(contents(head, "og:image")).toEqual([
      "https://example.com/a.png",
      "https://example.com/b.png",
    ]);
    expect(contents(head, "article:tag")).toEqual(["site"]);
  });

  it("leaves an og:title and a twitter:title a global head set explicitly", () => {
    const head = fill(
      [
        {
          title: "Site",
          description: "Tagline",
          og: { title: "Custom OG" },
          twitter: { title: "Custom Twitter" },
        },
      ],
      [{ title: "Pricing" }],
    );

    expect(head.title).toBe("Pricing");
    expect(contents(head, "og:title")).toEqual(["Custom OG"]);
    expect(contents(head, "twitter:title")).toEqual(["Custom Twitter"]);
  });

  it("leaves a social title a global head wrote as a meta entry", () => {
    const head = fill(
      [{ title: "Site", meta: [{ property: "og:title", content: "By hand" }] }],
      [{ title: "Pricing" }],
    );

    expect(contents(head, "og:title")).toEqual(["By hand"]);
  });

  it("retitles a derived social title through every level, and after the pages", () => {
    const head = fill(
      [{ title: "Site", description: "Tagline" }],
      [{ title: "Docs" }, { title: "Intro" }],
      () => ({ title: "Trail" }),
    );

    expect(head.title).toBe("Trail");
    expect(contents(head, "og:title")).toEqual(["Trail"]);
    expect(contents(head, "twitter:title")).toEqual(["Trail"]);
  });

  it("keeps an explicit canonical link, and fills no second one", () => {
    const provider = Alepha.create({
      env: { PUBLIC_URL: "https://example.com" },
    }).inject(HeadProvider);
    const state: { head: Head; layers: any[] } = {
      head: {},
      layers: [
        {
          path: "/copy",
          route: {
            head: {
              link: [
                { rel: "canonical", href: "https://example.com/original" },
              ],
            },
          },
        },
      ],
    };

    provider.fillHead(state);

    expect(
      (state.head.link ?? []).filter((it) => it.rel === "canonical"),
    ).toEqual([{ rel: "canonical", href: "https://example.com/original" }]);
    // The three tags that name the page's URL agree.
    expect(contents(state.head, "og:url")).toEqual([
      "https://example.com/original",
    ]);
    expect(contents(state.head, "twitter:url")).toEqual([
      "https://example.com/original",
    ]);
  });

  it("writes no og:url from an explicit canonical that is relative", () => {
    const provider = Alepha.create({
      env: { PUBLIC_URL: "https://example.com" },
    }).inject(HeadProvider);
    const state: { head: Head; layers: any[] } = {
      head: {},
      layers: [
        {
          path: "/copy",
          route: { head: { link: [{ rel: "canonical", href: "/original" }] } },
        },
      ],
    };

    provider.fillHead(state);

    expect(state.head.link).toEqual([{ rel: "canonical", href: "/original" }]);
    expect(contents(state.head, "og:url")).toEqual([]);
  });

  it("gives og:title and twitter:title the title of a page that sets only a title", () => {
    const head = fill(
      [{ title: "Site", description: "Tagline" }],
      [{ title: "Pricing" }],
    );

    expect(head.title).toBe("Pricing");
    expect(contents(head, "og:title")).toEqual(["Pricing"]);
    expect(contents(head, "twitter:title")).toEqual(["Pricing"]);
    expect(contents(head, "description")).toEqual(["Tagline"]);
  });

  it("adds no social tag to an app whose heads only set titles", () => {
    const head = fill([{ title: "Site" }], [{ title: "Pricing" }]);

    expect(head.meta ?? []).toEqual([]);
  });

  it("chains the title through every page level", () => {
    const head = fill(
      [{ title: "App", titleSeparator: " | " }],
      [{ title: "Docs" }, { title: "Intro" }],
    );

    expect(head.title).toBe("Intro | Docs | App");
  });

  it("lets a page change the separator for the levels under it", () => {
    const head = fill(
      [{ title: "App", titleSeparator: " | " }],
      [{ title: "Docs", titleSeparator: " - " }, { title: "Intro" }],
    );

    expect(head.title).toBe("Intro - Docs | App");
  });

  it("keeps one canonical when a layout and its child both name a url", () => {
    const head = fill(
      [],
      [{ url: "https://example.com/docs" }, { url: "https://example.com/a" }],
    );

    expect((head.link ?? []).filter((it) => it.rel === "canonical")).toEqual([
      { rel: "canonical", href: "https://example.com/a" },
    ]);
    expect(contents(head, "og:url")).toEqual(["https://example.com/a"]);
  });
});
