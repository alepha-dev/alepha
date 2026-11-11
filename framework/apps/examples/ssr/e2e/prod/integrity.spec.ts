import { createHash } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

/**
 * Subresource Integrity on a real production build (#Q3319): every script
 * and stylesheet the document has a tag for carries the SHA-384 of the bytes
 * served, and the browser refuses a file whose bytes were changed in transit.
 */
test.describe("Subresource Integrity", () => {
  const tags = (html: string) =>
    [
      ...html.matchAll(
        /<(?:script[^>]*\bsrc="([^"]+)"|link[^>]*\brel="(?:modulepreload|stylesheet)"[^>]*\bhref="([^"]+)")[^>]*>/g,
      ),
    ].map((match) => ({
      tag: match[0],
      url: match[1] ?? match[2],
      integrity: match[0].match(/\bintegrity="([^"]+)"/)?.[1],
    }));

  /**
   * Serve `url` with a line appended that would set a global if it ran. A
   * fresh content-length and no content-encoding: kept, the original ones
   * would cut the body back to its untampered bytes or garble it.
   */
  const tamper = async (page: Page, url: string) => {
    await page.route(`**${url}`, async (route) => {
      const response = await route.fetch();
      const {
        "content-length": _length,
        "content-encoding": _encoding,
        ...headers
      } = response.headers();
      await route.fulfill({
        status: response.status(),
        headers,
        body: `${await response.text()}\n;window.__tampered = 1;`,
      });
    });
  };

  test("every entry script, stylesheet and modulepreload carries the hash of its bytes", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text();
    const assets = tags(html).filter((it) => !it.url.startsWith("/config.js"));

    expect(assets.length).toBeGreaterThan(1);
    for (const asset of assets) {
      expect(asset.integrity, asset.tag).toBeDefined();
      const body = await (await request.get(asset.url)).body();
      expect(asset.integrity, asset.url).toBe(
        `sha384-${createHash("sha384").update(body).digest("base64")}`,
      );
    }
  });

  test("the Link header preloads carry the same integrity as the tags", async ({
    request,
  }) => {
    const response = await request.get("/");
    const html = await response.text();
    const link = response.headers().link ?? "";

    for (const asset of tags(html).filter((it) => it.integrity)) {
      const entry = link
        .split(/,\s*(?=<)/)
        .find((it) => it.startsWith(`<${asset.url}>`));
      if (entry) {
        expect(entry).toContain(`integrity="${asset.integrity}"`);
      }
    }
  });

  for (const which of ["entry script", "preloaded chunk"] as const) {
    test(`the browser refuses a tampered ${which}`, async ({
      page,
      request,
    }) => {
      const html = await (await request.get("/")).text();
      const all = tags(html).filter((it) => it.integrity);
      const target =
        which === "entry script"
          ? all.find((it) => it.tag.startsWith("<script"))
          : all.find(
              (it) =>
                it.tag.includes("modulepreload") &&
                !all.some(
                  (s) => s.tag.startsWith("<script") && s.url === it.url,
                ),
            );
      expect(target, which).toBeDefined();

      const refused: string[] = [];
      page.on("console", (message) => {
        if (/integrity/.test(message.text())) {
          refused.push(message.text());
        }
      });
      await tamper(page, target!.url);

      await page.goto("/");

      await expect
        .poll(() => refused.some((it) => it.includes(target!.url)))
        .toBe(true);
      expect(await page.evaluate(() => (window as any).__tampered)).toBe(
        undefined,
      );
    });
  }
});
