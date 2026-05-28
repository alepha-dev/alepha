import { expect, test } from "@playwright/test";

const cookieValue = (mode: string, theme: string) =>
  encodeURIComponent(
    JSON.stringify({ mode, theme, sidebar: { collapsed: false } }),
  );

test.describe("theme no-flash", () => {
  test("dark mode + theme-arcane applied before paint via boot script", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      {
        name: "alepha-ui",
        value: cookieValue("dark", "arcane"),
        url: "http://localhost:3303",
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
});
