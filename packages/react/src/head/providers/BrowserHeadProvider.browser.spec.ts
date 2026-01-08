import { $page } from "@alepha/react/router";
import { Alepha } from "alepha";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AlephaReactHead } from "../index.browser.ts";
import type { Head } from "../interfaces/Head.ts";
import { BrowserHeadProvider } from "./BrowserHeadProvider.ts";

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

  describe("$page integration", () => {
    class TestApp {
      simplePage = $page({
        path: "/",
        head: {
          title: "Simple Page",
          bodyAttributes: { class: "simple-page" },
        },
        component: () => "Simple content",
      });

      complexPage = $page({
        path: "/complex",
        head: {
          title: "Complex Page",
          htmlAttributes: {
            lang: "en",
            "data-theme": "dark",
          },
          bodyAttributes: {
            class: "complex-page",
            style: "background: black;",
          },
          meta: [
            { name: "description", content: "Complex test page" },
            {
              name: "viewport",
              content: "width=device-width, initial-scale=1",
            },
          ],
        },
        component: () => "Complex content",
      });
    }

    afterEach(() => {
      document.body.querySelector("#root")?.remove();
    });

    it("should render simple page head configuration", async () => {
      const alepha = Alepha.create().with(AlephaReactHead).with(TestApp);
      await alepha.start();

      expect(document.title).toBe("Simple Page");
      expect(document.body.getAttribute("class")).toBe("simple-page");
    });

    it("should get current head state and match page configuration", async () => {
      const alepha = Alepha.create().with(AlephaReactHead);
      const app = alepha.inject(TestApp);
      await alepha.start();

      // Apply complex page head
      const headConfig = app.complexPage.options.head as Head;
      provider.renderHead(document, headConfig);

      // Get current head state
      const currentHead = provider.getHead(document);

      expect(currentHead.title).toBe(headConfig.title);
      expect(currentHead.htmlAttributes?.lang).toBe(
        headConfig.htmlAttributes?.lang,
      );
      expect(currentHead.bodyAttributes?.class).toBe(
        headConfig.bodyAttributes?.class,
      );
      expect(currentHead.meta).toContainEqual({
        name: "description",
        content: "Complex test page",
      });
    });
  });
});
