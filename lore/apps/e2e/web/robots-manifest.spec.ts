import { expect, test } from "./_fixtures.ts";

/**
 * `robots.txt` and the manifest are code now, and a file in `public/` would
 * answer ahead of the route, so this drives the built server rather than the
 * primitives: the route is what a crawler reaches.
 *
 * The other host is `$robots.spec.ts`'s: this server has no `PUBLIC_URL`, as a
 * self-hosted image has none.
 */
test.describe("robots.txt and the manifest", () => {
  test("robots.txt keeps crawlers out of what is not content", async ({
    request,
  }) => {
    const response = await request.get("/robots.txt");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("Disallow: /auth");
    expect(body).toContain("Disallow: /account");
  });

  test("the manifest answers as one, and every page links it", async ({
    request,
    page,
  }) => {
    const response = await request.get("/manifest.webmanifest");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain(
      "application/manifest+json",
    );
    expect(await response.json()).toMatchObject({
      name: "Lore",
      start_url: "/",
      theme_color: "#010409",
    });

    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
  });
});
