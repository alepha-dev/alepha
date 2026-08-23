import { expect, test } from "@playwright/test";

const cookieValue = (mode: string, theme: string) =>
  encodeURIComponent(
    JSON.stringify({ mode, theme, sidebar: { collapsed: false } }),
  );

test.describe("theme no-flash", () => {
  test("dark mode + theme-arcane applied before paint via boot script", async ({
    context,
    page,
    baseURL,
  }) => {
    await context.addCookies([
      {
        name: "alepha-ui",
        value: cookieValue("dark", "arcane"),
        url: String(baseURL),
      },
    ]);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const klass = await page.evaluate(() => document.documentElement.className);
    expect(klass).toContain("dark");
    expect(klass).toContain("theme-arcane");
  });

  test("no dark class without cookie + system=light", async ({
    context,
    page,
  }) => {
    await context.clearCookies();
    await page.emulateMedia({ colorScheme: "light" });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const klass = await page.evaluate(() => document.documentElement.className);
    expect(klass).not.toContain("dark");
    expect(klass).not.toContain("theme-");
  });

  test("system=dark resolves to dark via prefers-color-scheme", async ({
    context,
    page,
  }) => {
    await context.clearCookies();
    await page.emulateMedia({ colorScheme: "dark" });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const klass = await page.evaluate(() => document.documentElement.className);
    expect(klass).toContain("dark");
  });

  // Regression for blight #10596 (React #418 on the SSR'd home page). With
  // `mode = "system"` (no cookie) and a dark OS, `useResolvedColorMode` used to
  // resolve "light" on the server (no matchMedia) but "dark" on the client's
  // first render, so the color-mode toggle icon hydrated Sun↔Moon and React
  // threw a hydration mismatch. The home page is the only SSR'd route, so it is
  // the only place this can surface.
  test("system=dark home SSR hydrates without a React #418 mismatch", async ({
    context,
    page,
  }) => {
    await context.clearCookies();
    await page.emulateMedia({ colorScheme: "dark" });

    const mismatches: string[] = [];
    const isMismatch = (text: string) =>
      /react error #41[589]|#42[35]|hydrat|did ?n[o']t match/i.test(text);
    page.on("console", (msg) => {
      if (msg.type() === "error" && isMismatch(msg.text())) {
        mismatches.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      if (isMismatch(err.message)) mismatches.push(err.message);
    });

    await page.goto("/", { waitUntil: "networkidle" });
    // Let hydration run to completion before asserting.
    await page.waitForTimeout(500);

    expect(mismatches).toEqual([]);
  });
});
