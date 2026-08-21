import { Alepha } from "alepha";
import { $head } from "alepha/react/head";
import { HttpClient, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { ssrManifestAtom } from "../atoms/ssrManifestAtom.ts";
import { $page } from "../index.ts";

describe("ReactServerTemplateProvider", () => {
  describe("streaming", () => {
    class App {
      head = $head({
        htmlAttributes: { lang: "en" },
      });

      home = $page({
        path: "/",
        head: {
          title: "Test Page",
          meta: [{ name: "description", content: "Test description" }],
        },
        component: () => "Hello World",
      });

      withLoader = $page({
        path: "/with-loader",
        head: { title: "Loader Page" },
        loader: async () => ({ data: "loaded" }),
        component: ({ data }) => `Data: ${data}`,
      });
    }

    it("should stream complete HTML document with correct structure", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
      }).with(App);

      await alepha.start();

      const server = alepha.inject(ServerProvider);
      const http = alepha.inject(HttpClient);

      const response = await http.fetch(`${server.hostname}/`);

      // Verify HTML structure
      expect(response.data).toContain("<!DOCTYPE html>");
      expect(response.data).toContain('<html lang="en">');
      expect(response.data).toContain("<head>");
      expect(response.data).toContain('<meta charset="UTF-8">');
      expect(response.data).toContain('<meta name="viewport"');
      expect(response.data).toContain("<title>Test Page</title>");
      expect(response.data).toContain(
        '<meta name="description" content="Test description">',
      );
      expect(response.data).toContain("</head>");
      expect(response.data).toContain("<body>");
      expect(response.data).toContain('<div id="root">');
      expect(response.data).toContain("Hello World");
      expect(response.data).toContain("</div>");
      expect(response.data).toContain("</body>");
      expect(response.data).toContain("</html>");

      await alepha.stop();
    });

    it("should include hydration data when enabled", async ({ expect }) => {
      const alepha = Alepha.create({
        env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
      }).with(App);

      await alepha.start();

      const server = alepha.inject(ServerProvider);
      const http = alepha.inject(HttpClient);

      const response = await http.fetch(`${server.hostname}/with-loader`);

      // Verify hydration script is present
      expect(response.data).toContain(
        '<script id="__ssr" type="application/json">',
      );
      expect(response.data).toContain("</script>");

      // Verify hydration data structure
      expect(response.data).toMatch(/"alepha\.react\.router\.layers"/);

      await alepha.stop();
    });

    it("should include entry assets in head when manifest is available", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
      }).with(App);

      // Set up mock SSR manifest
      alepha.store.set(ssrManifestAtom, {
        client: {
          "src/entry.tsx": {
            file: "assets/entry.abc123.js",
            isEntry: true,
            css: ["assets/style.def456.css"],
          },
        },
      });

      await alepha.start();

      const server = alepha.inject(ServerProvider);
      const http = alepha.inject(HttpClient);

      const response = await http.fetch(`${server.hostname}/`);

      // Verify entry assets are in the head
      // Note: CSS stylesheets do NOT include crossorigin="" to avoid credential mode mismatches
      // with Early Hints preloading (HTTP 103). JS modules still need crossorigin="".
      expect(response.data).toContain(
        '<link rel="stylesheet" href="/assets/style.def456.css">',
      );
      expect(response.data).toContain(
        '<script type="module" crossorigin="" src="/assets/entry.abc123.js"></script>',
      );

      await alepha.stop();
    });

    it("should handle pages with loaders correctly", async ({ expect }) => {
      const alepha = Alepha.create({
        env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
      }).with(App);

      await alepha.start();

      const server = alepha.inject(ServerProvider);
      const http = alepha.inject(HttpClient);

      const response = await http.fetch(`${server.hostname}/with-loader`);

      // Verify loader data is rendered
      expect(response.data).toContain("Data: loaded");

      await alepha.stop();
    });

    it("should set correct content-type header", async ({ expect }) => {
      const alepha = Alepha.create({
        env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
      }).with(App);

      await alepha.start();

      const server = alepha.inject(ServerProvider);
      const http = alepha.inject(HttpClient);

      const response = await http.fetch(`${server.hostname}/`);

      expect(response.headers.get("content-type")).toBe("text/html");

      await alepha.stop();
    });

    it("should set cache-control headers for SSR responses", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
      }).with(App);

      await alepha.start();

      const server = alepha.inject(ServerProvider);
      const http = alepha.inject(HttpClient);

      const response = await http.fetch(`${server.hostname}/`);

      expect(response.headers.get("cache-control")).toContain("no-store");

      await alepha.stop();
    });
  });

  describe("error handling", () => {
    class ErrorApp {
      errorPage = $page({
        path: "/error",
        loader: async () => {
          throw new Error("Loader error");
        },
        component: () => "Should not render",
      });
    }

    it("should render error when loader throws", async ({ expect }) => {
      const alepha = Alepha.create({
        env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
      }).with(ErrorApp);

      await alepha.start();

      const server = alepha.inject(ServerProvider);
      const http = alepha.inject(HttpClient);

      const response = await http.fetch(`${server.hostname}/error`);

      // Should still return a valid HTML response with error
      expect(response.data).toContain("<!DOCTYPE html>");
      expect(response.data).toContain("Loader error");

      await alepha.stop();
    });
  });

  describe("meta media", () => {
    class MediaApp {
      home = $page({
        path: "/",
        head: {
          title: "Themed",
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
            { name: "description", content: "No media here" },
          ],
        },
        component: () => "Hello",
      });
    }

    it("should serialize the media attribute, and omit it when absent", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
      }).with(MediaApp);

      await alepha.start();

      const server = alepha.inject(ServerProvider);
      const http = alepha.inject(HttpClient);

      const response = await http.fetch(`${server.hostname}/`);
      const html = response.data as string;

      expect(html).toContain(
        '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">',
      );
      expect(html).toContain(
        '<meta name="theme-color" content="#010409" media="(prefers-color-scheme: dark)">',
      );
      // A meta without `media` must not grow an empty attribute.
      expect(html).toContain(
        '<meta name="description" content="No media here">',
      );

      await alepha.stop();
    });
  });
});
