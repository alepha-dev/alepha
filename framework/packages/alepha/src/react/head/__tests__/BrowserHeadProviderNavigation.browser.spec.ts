import { Alepha } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";

import type { Head } from "../interfaces/Head.ts";
import { BrowserHeadProvider } from "../providers/BrowserHeadProvider.ts";
import { HeadProvider } from "../providers/HeadProvider.ts";

/**
 * What the document holds after a client navigation must be what a hard load
 * of the same URL would produce.
 */
describe("BrowserHeadProvider across navigations", () => {
  let provider: BrowserHeadProvider;
  let global: HeadProvider;

  const navigate = (path: string, head?: Head | (() => Head)) =>
    provider.fillAndRenderHead({
      head: {},
      layers: [{ path, route: { head } }],
    });

  const description = () =>
    document.querySelector('meta[name="description"]')?.getAttribute("content");

  beforeEach(() => {
    const alepha = Alepha.create();
    provider = alepha.inject(BrowserHeadProvider);
    global = alepha.inject(HeadProvider);

    document.title = "";
    document.head.innerHTML = "";
    for (const el of [document.body, document.documentElement]) {
      for (const attr of Array.from(el.attributes)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  describe("selectors", () => {
    it("renders a link whose href holds quotes and angle brackets", () => {
      const href =
        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"></svg>';

      provider.renderHead(document, { link: [{ rel: "icon", href }] });
      provider.renderHead(document, { link: [{ rel: "icon", href }] });

      const links = [...document.querySelectorAll("link")];
      expect(links.map((it) => it.getAttribute("href"))).toEqual([href]);
    });

    it("renders a meta whose name, property or media holds a quote", () => {
      const meta = [
        { name: 'a"b', content: "1" },
        { property: 'og:"x', content: "2" },
        { name: "theme-color", content: "3", media: '(x: "y")' },
      ];

      provider.renderHead(document, { meta });
      provider.renderHead(document, { meta });

      expect(provider.getHead(document).meta).toEqual([
        { name: 'a"b', content: "1" },
        { name: "theme-color", content: "3", media: '(x: "y")' },
        { property: 'og:"x', content: "2" },
      ]);
    });

    it("renders a script whose src holds a quote, once", () => {
      const script = [{ src: '/a.js?q="1"' }];

      provider.renderHead(document, { script });
      provider.renderHead(document, { script });

      expect(document.querySelectorAll("script")).toHaveLength(1);
    });
  });

  describe("refreshGlobalHead", () => {
    it("keeps the page's title and description over the global ones", () => {
      global.global = [{ title: "Site", description: "Tagline" }];
      navigate("/docs", { title: "Docs", description: "Page" });
      expect(document.title).toBe("Docs");
      expect(description()).toBe("Page");

      provider.refreshGlobalHead();

      expect(document.title).toBe("Docs");
      expect(description()).toBe("Page");
    });

    it("applies what a global head function now returns", () => {
      let color = "#fff";
      global.global = [
        () => ({
          title: "Site",
          htmlAttributes: { "data-color": color },
          meta: [{ name: "theme-color", content: color }],
        }),
      ];
      navigate("/docs", { title: "Docs" });

      color = "#000";
      provider.refreshGlobalHead();

      expect(document.title).toBe("Docs");
      expect(document.documentElement.getAttribute("data-color")).toBe("#000");
      expect(
        document
          .querySelector('meta[name="theme-color"]')
          ?.getAttribute("content"),
      ).toBe("#000");
    });

    it("applies the global head alone before any page has rendered", () => {
      global.global = [{ title: "Site", description: "Tagline" }];

      provider.refreshGlobalHead();

      expect(document.title).toBe("Site");
      expect(description()).toBe("Tagline");
    });
  });

  describe("repeated properties", () => {
    const images = () =>
      (provider.getHead(document).meta ?? []).filter(
        (it) => it.property === "og:image",
      );

    it("renders every tag of a repeated property, as the server does", () => {
      const meta = [
        { property: "og:image", content: "https://example.com/a.png" },
        { property: "og:image", content: "https://example.com/b.png" },
      ];

      navigate("/a", { meta });
      navigate("/a", { meta });

      expect(images()).toEqual(meta);
    });

    it("drops the second tag on a page that declares one", () => {
      navigate("/a", {
        meta: [
          { property: "og:image", content: "https://example.com/a.png" },
          { property: "og:image", content: "https://example.com/b.png" },
        ],
      });

      navigate("/b", {
        meta: [{ property: "og:image", content: "https://example.com/c.png" }],
      });

      expect(images()).toEqual([
        { property: "og:image", content: "https://example.com/c.png" },
      ]);
    });
  });

  describe("attributes", () => {
    it("removes only its own class tokens, not a theme script's", () => {
      document.documentElement.setAttribute("class", "dark");
      document.body.setAttribute("class", "sidebar-collapsed");
      global.global = [{ htmlAttributes: { class: "app" } }];

      navigate("/a", { bodyAttributes: { class: "landing wide" } });
      expect(document.body.getAttribute("class")).toBe(
        "sidebar-collapsed landing wide",
      );
      expect(document.documentElement.getAttribute("class")).toBe("dark app");

      global.global = [];
      navigate("/b", { bodyAttributes: { class: "wide" } });

      expect(document.body.getAttribute("class")).toBe(
        "sidebar-collapsed wide",
      );
      expect(document.documentElement.getAttribute("class")).toBe("dark");
    });

    it("drops a page's body attribute on the page after it", () => {
      navigate("/a", { title: "A", bodyAttributes: { class: "landing" } });
      expect(document.body.getAttribute("class")).toBe("landing");

      navigate("/b", { title: "B" });

      expect(document.body.hasAttribute("class")).toBe(false);
    });

    it("drops an html attribute a global head stops returning", () => {
      let rtl = true;
      global.global = [
        (): Head => ({
          htmlAttributes: rtl ? { lang: "ar", dir: "rtl" } : { lang: "en" },
        }),
      ];
      navigate("/a");
      expect(document.documentElement.getAttribute("dir")).toBe("rtl");

      rtl = false;
      navigate("/b");

      expect(document.documentElement.getAttribute("lang")).toBe("en");
      expect(document.documentElement.hasAttribute("dir")).toBe(false);
    });

    it("leaves attributes it never set alone", () => {
      document.body.setAttribute("data-extension", "x");
      document.documentElement.setAttribute("class", "dark");

      navigate("/a", { bodyAttributes: { class: "landing" } });
      navigate("/b");

      expect(document.body.getAttribute("data-extension")).toBe("x");
      expect(document.documentElement.getAttribute("class")).toBe("dark");
    });
  });
});
