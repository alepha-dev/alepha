import { expect, test } from "@playwright/test";

test.describe("SSR Preload Links", () => {
  test("home page (/) has correct script and preload", async ({ request }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);

    const html = await response.text();

    // Count script tags with type="module"
    const scriptMatches = html.match(/<script[^>]*type="module"[^>]*>/g) || [];
    expect(scriptMatches.length).toBe(1);

    // Count modulepreload links
    const preloadMatches =
      html.match(/<link[^>]*rel="modulepreload"[^>]*>/g) || [];
    expect(preloadMatches.length).toBe(1);
  });

  test("about page (/about) has correct script and preload", async ({
    request,
  }) => {
    const response = await request.get("/about");
    expect(response.status()).toBe(200);

    const html = await response.text();

    // Count script tags with type="module"
    const scriptMatches = html.match(/<script[^>]*type="module"[^>]*>/g) || [];
    expect(scriptMatches.length).toBe(1);

    // Count modulepreload links
    const preloadMatches =
      html.match(/<link[^>]*rel="modulepreload"[^>]*>/g) || [];
    expect(preloadMatches.length).toBe(1);
  });

  test("preload links are different for / and /about", async ({ request }) => {
    const homeResponse = await request.get("/");
    const aboutResponse = await request.get("/about");

    const homeHtml = await homeResponse.text();
    const aboutHtml = await aboutResponse.text();

    // Extract preload href from home page
    const homePreloadMatch = homeHtml.match(
      /<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"[^>]*>/,
    );
    expect(homePreloadMatch).not.toBeNull();
    const homePreloadHref = homePreloadMatch![1];

    // Extract preload href from about page
    const aboutPreloadMatch = aboutHtml.match(
      /<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"[^>]*>/,
    );
    expect(aboutPreloadMatch).not.toBeNull();
    const aboutPreloadHref = aboutPreloadMatch![1];

    // Preload hrefs should be different (different chunks for different pages)
    expect(homePreloadHref).not.toBe(aboutPreloadHref);
  });
});
