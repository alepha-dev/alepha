import { expect, test } from "@playwright/test";

/**
 * The front page speaks for the three products, and the framework's home
 * moved to `/framework` (#Q4556).
 */
test.describe("Front page", () => {
  test("/ names the three products, each with its lane, the loop and the closing block", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("h1 img[alt='Alepha']")).toBeVisible();
    await expect(page.locator(".hero-lead")).toContainText("the framework");
    await expect(page.locator(".hero-lead")).toContainText("Lore");
    await expect(page.locator(".hero-lead")).toContainText("Bay");

    for (const name of ["Framework", "Lore", "Bay"]) {
      await expect(
        page.getByRole("heading", { level: 3, name, exact: true }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("heading", { name: "Build, Ship, Run, Watch, Fix" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Try it in one command" }),
    ).toBeVisible();

    // No product is the front page, so none lights up.
    const nav = page.getByRole("navigation", { name: "Products" });
    await expect(nav.locator("[aria-current='page']")).toHaveCount(0);
  });

  test("the site-wide head speaks for the ecosystem, /framework for the framework", async ({
    page,
  }) => {
    await page.goto("/");
    const description = page.locator("meta[name='description']");
    await expect(description).toHaveAttribute("content", /Lore/);
    await expect(page.locator("meta[property='og:title']")).toHaveAttribute(
      "content",
      /Lore and Bay/,
    );

    await page.goto("/framework");
    await expect(description).toHaveAttribute(
      "content",
      /full-stack TypeScript framework/,
    );
    await expect(page.locator("meta[property='og:title']")).toHaveAttribute(
      "content",
      /One schema, everywhere/,
    );
  });

  test("/framework is the framework's home, and its header link lights up there and on its guides", async ({
    page,
  }) => {
    await page.goto("/framework");
    await expect(page.locator("#seam")).toBeAttached();
    await expect(
      page.getByText("npx alepha@latest init my-app").first(),
    ).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Products" });
    const framework = nav.getByRole("link", { name: "Framework" });
    await expect(framework).toHaveAttribute("href", "/framework");
    await expect(framework).toHaveAttribute("aria-current", "page");

    await page.goto("/docs/guides-introduction");
    await expect(framework).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Lore" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the product links stay reachable on a phone", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 740 },
    });
    const page = await context.newPage();
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Products" });
    for (const name of ["Framework", "Lore", "Bay"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    await nav.getByRole("link", { name: "Bay" }).click();
    await expect(page).toHaveURL(/\/bay$/);
    await context.close();
  });

  test("the header fits a 320px phone, on the front page and on a guide", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 640 },
    });
    const page = await context.newPage();
    for (const path of ["/", "/docs/guides-introduction"]) {
      await page.goto(path);
      const header = page.locator("header").first();
      await expect(header).toBeVisible();
      const right = await header.evaluate((it) =>
        Math.max(
          ...[...it.querySelectorAll("a, button")].map(
            (el) => el.getBoundingClientRect().right,
          ),
        ),
      );
      expect(right, path).toBeLessThanOrEqual(320);
    }
    await context.close();
  });
});
