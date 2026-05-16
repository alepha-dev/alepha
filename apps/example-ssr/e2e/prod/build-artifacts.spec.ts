import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const distDir = join(process.cwd(), "dist");
const publicDir = join(distDir, "public");

test.describe("Build Artifacts", () => {
  test.describe("Cloudflare Config", () => {
    test("wrangler.jsonc exists in dist/", () => {
      const wranglerPath = join(distDir, "wrangler.jsonc");
      expect(existsSync(wranglerPath)).toBe(true);
    });

    test("wrangler.jsonc is valid JSON", () => {
      const wranglerPath = join(distDir, "wrangler.jsonc");
      const content = readFileSync(wranglerPath, "utf-8");

      // JSONC allows comments, but this file should be parseable as JSON
      const config = JSON.parse(content);

      expect(config.name).toBeDefined();
      expect(config.main).toBe("./main.cloudflare.js");
      expect(config.compatibility_flags).toContain("nodejs_compat");
      expect(config.assets?.directory).toBe("./public");
    });

    test("main.cloudflare.js exists in dist/", () => {
      const mainPath = join(distDir, "main.cloudflare.js");
      expect(existsSync(mainPath)).toBe(true);

      const content = readFileSync(mainPath, "utf-8");
      expect(content.length).toBeGreaterThan(0);
    });
  });

  test.describe("Sitemap", () => {
    test("sitemap.xml exists in dist/public/", () => {
      const sitemapPath = join(publicDir, "sitemap.xml");
      expect(existsSync(sitemapPath)).toBe(true);
    });

    test("sitemap.xml is valid XML with URLs", () => {
      const sitemapPath = join(publicDir, "sitemap.xml");
      const content = readFileSync(sitemapPath, "utf-8");

      // Check XML declaration
      expect(content).toContain('<?xml version="1.0"');

      // Check urlset element
      expect(content).toContain("<urlset");
      expect(content).toContain("</urlset>");

      // Check that URLs are present
      expect(content).toContain("<url>");
      expect(content).toContain("<loc>");

      // Check specific routes are in sitemap
      expect(content).toMatch(/<loc>[^<]*\/<\/loc>/); // root URL
      expect(content).toMatch(/<loc>[^<]*\/about<\/loc>/); // about URL
    });

    test("sitemap.xml is accessible via HTTP", async ({ request }) => {
      const response = await request.get("/sitemap.xml");
      expect(response.status()).toBe(200);

      const content = await response.text();
      expect(content).toContain("<urlset");
    });
  });
});
