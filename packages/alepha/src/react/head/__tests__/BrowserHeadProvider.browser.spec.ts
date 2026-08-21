import { Alepha } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";

import type { Head } from "../interfaces/Head.ts";
import { BrowserHeadProvider } from "../providers/BrowserHeadProvider.ts";

describe("BrowserHeadProvider", () => {
  let alepha: Alepha;
  let provider: BrowserHeadProvider;

  beforeEach(async () => {
    alepha = Alepha.create();
    provider = alepha.inject(BrowserHeadProvider);

    // Reset document state
    document.title = "";
    document.head.innerHTML = "";
    document.body.removeAttribute("class");
    document.body.removeAttribute("style");
    document.documentElement.removeAttribute("lang");
    document.documentElement.removeAttribute("class");
  });

  describe("getHead", () => {
    it("should return current document head state", () => {
      document.title = "Test Title";
      document.body.setAttribute("class", "test-class");
      document.documentElement.setAttribute("lang", "en");

      const meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      meta.setAttribute("content", "Test description");
      document.head.appendChild(meta);

      const head = provider.getHead(document);

      expect(head.title).toBe("Test Title");
      expect(head.bodyAttributes?.class).toBe("test-class");
      expect(head.htmlAttributes?.lang).toBe("en");
      expect(head.meta).toContainEqual({
        name: "description",
        content: "Test description",
      });
    });

    it("should handle empty document state", () => {
      const head = provider.getHead(document);

      expect(head.title).toBe("");
      expect(head.bodyAttributes).toEqual({});
      expect(head.htmlAttributes).toEqual({});
      expect(head.meta).toEqual([]);
    });
  });

  describe("renderHead", () => {
    it("should set document title", () => {
      const head: Head = { title: "New Title" };

      provider.renderHead(document, head);

      expect(document.title).toBe("New Title");
    });

    it("should set body attributes", () => {
      const head: Head = {
        bodyAttributes: {
          class: "new-class",
          style: "background: blue;",
        },
      };

      provider.renderHead(document, head);

      expect(document.body.getAttribute("class")).toBe("new-class");
      expect(document.body.getAttribute("style")).toBe("background: blue;");
    });

    it("should remove body attributes when value is falsy", () => {
      document.body.setAttribute("class", "old-class");

      const head: Head = {
        bodyAttributes: {
          class: "",
        },
      };

      provider.renderHead(document, head);

      expect(document.body.hasAttribute("class")).toBe(false);
    });

    it("should set html attributes", () => {
      const head: Head = {
        htmlAttributes: {
          lang: "fr",
          dir: "ltr",
        },
      };

      provider.renderHead(document, head);

      expect(document.documentElement.getAttribute("lang")).toBe("fr");
      expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    });

    it("should remove html attributes when value is falsy", () => {
      document.documentElement.setAttribute("lang", "en");

      const head: Head = {
        htmlAttributes: {
          lang: "",
        },
      };

      provider.renderHead(document, head);

      expect(document.documentElement.hasAttribute("lang")).toBe(false);
    });

    it("should create new meta tags", () => {
      const head: Head = {
        meta: [
          { name: "description", content: "Test description" },
          { name: "keywords", content: "test, browser" },
        ],
      };

      provider.renderHead(document, head);

      const descriptionMeta = document.querySelector(
        'meta[name="description"]',
      );
      const keywordsMeta = document.querySelector('meta[name="keywords"]');

      expect(descriptionMeta?.getAttribute("content")).toBe("Test description");
      expect(keywordsMeta?.getAttribute("content")).toBe("test, browser");
    });

    it("should update existing meta tags", () => {
      // Pre-populate with existing meta tag
      const existingMeta = document.createElement("meta");
      existingMeta.setAttribute("name", "description");
      existingMeta.setAttribute("content", "Old description");
      document.head.appendChild(existingMeta);

      const head: Head = {
        meta: [{ name: "description", content: "New description" }],
      };

      provider.renderHead(document, head);

      const descriptionMeta = document.querySelector(
        'meta[name="description"]',
      );
      expect(descriptionMeta?.getAttribute("content")).toBe("New description");
      expect(
        document.querySelectorAll('meta[name="description"]'),
      ).toHaveLength(1);
    });

    describe("media", () => {
      it("should render a media attribute when one is given", () => {
        provider.renderHead(document, {
          meta: [
            {
              name: "theme-color",
              content: "#ffffff",
              media: "(prefers-color-scheme: light)",
            },
          ],
        });

        const el = document.querySelector('meta[name="theme-color"]');
        expect(el?.getAttribute("media")).toBe("(prefers-color-scheme: light)");
        expect(el?.getAttribute("content")).toBe("#ffffff");
      });

      it("should keep two tags of the same name apart by their media", () => {
        // The whole point of `media` on a meta: a light and a dark
        // `theme-color` coexist, and the browser picks. Deduping on the name
        // alone would let the second overwrite the first, leaving one tag
        // whose media query is wrong for the colour it carries.
        provider.renderHead(document, {
          meta: [
            {
              name: "theme-color",
              content: "#ffffff",
              media: "(prefers-color-scheme: light)",
            },
            {
              name: "theme-color",
              content: "#010409",
              media: "(prefers-color-scheme: dark)",
            },
          ],
        });

        const tags = document.querySelectorAll('meta[name="theme-color"]');
        expect(tags).toHaveLength(2);
        expect(tags[0].getAttribute("content")).toBe("#ffffff");
        expect(tags[1].getAttribute("content")).toBe("#010409");
      });

      it("should not let an unqualified tag overwrite a media-qualified one", () => {
        provider.renderHead(document, {
          meta: [
            {
              name: "theme-color",
              content: "#010409",
              media: "(prefers-color-scheme: dark)",
            },
            { name: "theme-color", content: "#888888" },
          ],
        });

        const qualified = document.querySelector(
          'meta[name="theme-color"][media]',
        );
        const plain = document.querySelector(
          'meta[name="theme-color"]:not([media])',
        );
        expect(qualified?.getAttribute("content")).toBe("#010409");
        expect(plain?.getAttribute("content")).toBe("#888888");
      });

      it("should update in place rather than duplicate on a second render", () => {
        const head: Head = {
          meta: [
            {
              name: "theme-color",
              content: "#ffffff",
              media: "(prefers-color-scheme: light)",
            },
          ],
        };

        provider.renderHead(document, head);
        provider.renderHead(document, {
          meta: [
            {
              name: "theme-color",
              content: "#eeeeee",
              media: "(prefers-color-scheme: light)",
            },
          ],
        });

        const tags = document.querySelectorAll('meta[name="theme-color"]');
        expect(tags).toHaveLength(1);
        expect(tags[0].getAttribute("content")).toBe("#eeeeee");
      });
    });

    describe("reconcile", () => {
      it("should drop a meta tag the next page does not declare", () => {
        // renderHead only ever added or updated. Navigating from a page with a
        // description to one without left the previous page's description in
        // the DOM — the client diverged from what a hard load would produce.
        provider.renderHead(
          document,
          { meta: [{ name: "description", content: "About us" }] },
          { reconcile: true },
        );
        provider.renderHead(document, { title: "Home" }, { reconcile: true });

        expect(document.querySelector('meta[name="description"]')).toBeNull();
      });

      it("should replace a canonical link rather than accumulate one per page", () => {
        // Links deduped on rel+href, so a new href simply appended: after N
        // navigations the document carried N canonicals.
        provider.renderHead(
          document,
          { link: [{ rel: "canonical", href: "/a" }] },
          { reconcile: true },
        );
        provider.renderHead(
          document,
          { link: [{ rel: "canonical", href: "/b" }] },
          { reconcile: true },
        );

        const hrefs = [
          ...document.querySelectorAll('link[rel="canonical"]'),
        ].map((it) => it.getAttribute("href"));
        expect(hrefs).toEqual(["/b"]);
      });

      it("should leave tags it never rendered alone", () => {
        // charset/viewport and anything a third-party script injected are not
        // ours to remove.
        const viewport = document.createElement("meta");
        viewport.setAttribute("name", "viewport");
        viewport.setAttribute("content", "width=device-width");
        document.head.appendChild(viewport);

        provider.renderHead(
          document,
          { meta: [{ name: "description", content: "About us" }] },
          { reconcile: true },
        );
        provider.renderHead(document, { title: "Home" }, { reconcile: true });

        expect(document.querySelector('meta[name="viewport"]')).not.toBeNull();
      });

      it("should adopt a server-rendered tag it updates in place", () => {
        // Hydration re-renders the SSR page's head: every tag it touches
        // becomes managed, so the FIRST client navigation can clean the
        // server's tags up too.
        const ssr = document.createElement("meta");
        ssr.setAttribute("name", "description");
        ssr.setAttribute("content", "Server rendered");
        document.head.appendChild(ssr);

        provider.renderHead(
          document,
          { meta: [{ name: "description", content: "Server rendered" }] },
          { reconcile: true },
        );
        provider.renderHead(document, { title: "Home" }, { reconcile: true });

        expect(document.querySelector('meta[name="description"]')).toBeNull();
      });

      it("should not remove anything when reconcile is off", () => {
        // refreshGlobalHead() re-applies ONLY global head; it must not treat
        // the current page's tags as stale.
        provider.renderHead(
          document,
          { meta: [{ name: "description", content: "About us" }] },
          { reconcile: true },
        );
        provider.renderHead(document, {
          meta: [{ property: "og:title", content: "Alepha" }],
        });

        expect(
          document
            .querySelector('meta[name="description"]')
            ?.getAttribute("content"),
        ).toBe("About us");
      });
    });

    it("should handle complete head object", () => {
      const head: Head = {
        title: "Complete Test",
        htmlAttributes: {
          lang: "es",
          class: "theme-dark",
        },
        bodyAttributes: {
          class: "page-test",
          "data-theme": "dark",
        },
        meta: [
          { name: "description", content: "Complete test page" },
          { name: "author", content: "Test Author" },
        ],
      };

      provider.renderHead(document, head);

      expect(document.title).toBe("Complete Test");
      expect(document.documentElement.getAttribute("lang")).toBe("es");
      expect(document.documentElement.getAttribute("class")).toBe("theme-dark");
      expect(document.body.getAttribute("class")).toBe("page-test");
      expect(document.body.getAttribute("data-theme")).toBe("dark");

      const descriptionMeta = document.querySelector(
        'meta[name="description"]',
      );
      const authorMeta = document.querySelector('meta[name="author"]');
      expect(descriptionMeta?.getAttribute("content")).toBe(
        "Complete test page",
      );
      expect(authorMeta?.getAttribute("content")).toBe("Test Author");
    });
  });
});
