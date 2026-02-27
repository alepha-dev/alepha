import { expect, test } from "@playwright/test";

test.describe("SSR Preload Links", () => {
  test("home page (/) has correct script and preload", async ({ request }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);

    const html = await response.text();

    // Count script tags with type="module"
    const scriptMatches = html.match(/<script[^>]*type="module"[^>]*>/g) || [];
    expect(scriptMatches.length).toBe(1);

    // Home page imports useAction/useClient/useState, so it should have its own chunk
    const preloadMatches =
      html.match(/<link[^>]*rel="modulepreload"[^>]*>/g) || [];
    expect(preloadMatches.length).toBeGreaterThanOrEqual(1);
  });

  test("about page (/about) has correct script", async ({ request }) => {
    const response = await request.get("/about");
    expect(response.status()).toBe(200);

    const html = await response.text();

    // Count script tags with type="module"
    const scriptMatches = html.match(/<script[^>]*type="module"[^>]*>/g) || [];
    expect(scriptMatches.length).toBe(1);

    // Note: modulepreload links are optional for small pages
    // Small chunks may be merged due to experimentalMinChunkSize optimization
  });
});
