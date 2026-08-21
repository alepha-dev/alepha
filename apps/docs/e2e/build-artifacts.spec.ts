import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { DOMParser } from "@xmldom/xmldom";

const distDir = join(process.cwd(), "dist/public");

test.describe("Build Artifacts", () => {
  test.describe("Pre-compressed Files", () => {
    test("brotli compressed files exist", async () => {
      const brFiles = findFiles(distDir, ".br");
      expect(brFiles.length).toBeGreaterThan(0);

      // Should have compressed JS files
      const jsBrFiles = brFiles.filter((f) => f.endsWith(".js.br"));
      expect(jsBrFiles.length).toBeGreaterThan(0);

      // Should have compressed CSS files
      const cssBrFiles = brFiles.filter((f) => f.endsWith(".css.br"));
      expect(cssBrFiles.length).toBeGreaterThan(0);
    });

    test("compressed files are smaller than originals", async () => {
      const jsFiles = findFiles(distDir, ".js").filter(
        (f) => !f.endsWith(".br"),
      );

      for (const jsFile of jsFiles.slice(0, 3)) {
        const brFile = `${jsFile}.br`;

        if (existsSync(brFile)) {
          const originalSize = statSync(jsFile).size;
          const brSize = statSync(brFile).size;
          expect(brSize).toBeLessThan(originalSize);
        }
      }
    });
  });

  test.describe("Sitemap", () => {
    test("sitemap.xml exists", async () => {
      const sitemapPath = join(distDir, "sitemap.xml");
      expect(existsSync(sitemapPath)).toBe(true);
    });

    test("sitemap.xml is valid XML", async () => {
      const sitemapPath = join(distDir, "sitemap.xml");
      const content = readFileSync(sitemapPath, "utf-8");

      const parser = new DOMParser();
      const doc = parser.parseFromString(content, "text/xml");

      // Check for XML parse errors
      const parseError = doc.getElementsByTagName("parsererror");
      expect(parseError.length).toBe(0);

      // Verify it's a valid sitemap
      const urlset = doc.getElementsByTagName("urlset");
      expect(urlset.length).toBe(1);
    });

    test("sitemap.xml contains URLs", async () => {
      const sitemapPath = join(distDir, "sitemap.xml");
      const content = readFileSync(sitemapPath, "utf-8");

      const parser = new DOMParser();
      const doc = parser.parseFromString(content, "text/xml");

      const urls = doc.getElementsByTagName("url");
      expect(urls.length).toBeGreaterThan(0);

      // Check that URLs have correct base
      const locs = doc.getElementsByTagName("loc");
      expect(locs.length).toBeGreaterThan(0);

      for (let i = 0; i < locs.length; i++) {
        const loc = locs[i].textContent;
        expect(loc).toMatch(/^https:\/\/alepha\.dev\//);
      }
    });

    test("sitemap.xml is accessible via HTTP", async ({ request }) => {
      const response = await request.get("/sitemap.xml");
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("xml");
    });
  });

  test.describe("Pre-rendered HTML", () => {
    test("pre-rendered HTML files exist", async () => {
      const htmlFiles = findFiles(distDir, ".html");
      expect(htmlFiles.length).toBeGreaterThan(0);
    });

    test("index.html exists", async () => {
      const indexPath = join(distDir, "index.html");
      expect(existsSync(indexPath)).toBe(true);

      const content = readFileSync(indexPath, "utf-8");
      expect(content).toContain("<!DOCTYPE html>");
      expect(content).toContain("Alepha");
    });

    test("404.html exists", async () => {
      const notFoundPath = join(distDir, "404.html");
      expect(existsSync(notFoundPath)).toBe(true);
    });

    test("docs pages are pre-rendered", async () => {
      const docsDir = join(distDir, "docs");
      expect(existsSync(docsDir)).toBe(true);

      const htmlFiles = findFiles(docsDir, ".html");
      expect(htmlFiles.length).toBeGreaterThan(10);
    });

    test("pre-rendered pages have compressed versions", async () => {
      const htmlFiles = findFiles(distDir, ".html");

      // Check a sample of pre-rendered files have .br versions
      const sampleFiles = htmlFiles.slice(0, 5);
      for (const htmlFile of sampleFiles) {
        expect(existsSync(`${htmlFile}.br`)).toBe(true);
      }
    });

    test("index.html contains entry script with hash", async () => {
      const indexPath = join(distDir, "index.html");
      const content = readFileSync(indexPath, "utf-8");

      // Should have entry.<hash>.js script tag
      const entryScriptMatch = content.match(
        /<script[^>]*src="[^"]*\/entry\.[a-zA-Z0-9-_]+\.js"[^>]*>/,
      );
      expect(entryScriptMatch).not.toBeNull();
    });

    test("index.html contains CSS stylesheet with hash", async () => {
      const indexPath = join(distDir, "index.html");
      const content = readFileSync(indexPath, "utf-8");

      // Should have asset.<hash>.css link tag
      const cssLinkMatch = content.match(
        /<link[^>]*href="[^"]*\/asset\.[a-zA-Z0-9-_]+\.css"[^>]*>/,
      );
      expect(cssLinkMatch).not.toBeNull();
    });

    test("404.html contains entry assets", async () => {
      const notFoundPath = join(distDir, "404.html");
      const content = readFileSync(notFoundPath, "utf-8");

      // Should have entry.<hash>.js script tag
      const entryScriptMatch = content.match(
        /<script[^>]*src="[^"]*\/entry\.[a-zA-Z0-9-_]+\.js"[^>]*>/,
      );
      expect(entryScriptMatch).not.toBeNull();

      // Should have asset.<hash>.css link tag
      const cssLinkMatch = content.match(
        /<link[^>]*href="[^"]*\/asset\.[a-zA-Z0-9-_]+\.css"[^>]*>/,
      );
      expect(cssLinkMatch).not.toBeNull();
    });
  });
});

function findFiles(dir: string, extension: string): string[] {
  const results: string[] = [];

  if (!existsSync(dir)) {
    return results;
  }

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, extension));
    } else if (entry.name.endsWith(extension)) {
      results.push(fullPath);
    }
  }

  return results;
}
