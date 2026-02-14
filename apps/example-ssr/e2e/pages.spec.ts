import { expect, type Page, test } from "@playwright/test";

test.describe("Page Rendering", () => {
  test.describe("Home Page", () => {
    test("renders with default greeting", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      await expect(page.locator("legend")).toHaveText("Hello, Alepha SSR!");
    });

    test("renders with custom name from query parameter", async ({ page }) => {
      await page.goto("/?name=World");
      await page.waitForLoadState("domcontentloaded");

      await expect(page.locator("legend")).toHaveText("Hello, World SSR!");
    });

    test("shows instruction text", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      await expect(page.locator("small")).toHaveText(
        "Add ?name=your-name to URL",
      );
    });

    test("has correct page title", async ({ page }) => {
      await page.goto("/");

      await expect(page).toHaveTitle("Home");
    });

    test("renders counter button", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      const button = page.locator("button");
      await expect(button).toBeVisible();
      await expect(button).toHaveText(/Click \d+/);
    });
  });

  test.describe("About Page", () => {
    test("renders heading and description", async ({ page }) => {
      await page.goto("/about");

      await expect(page.locator("h1")).toHaveText("About Page");
      await expect(page.locator("p")).toHaveText(
        "This is the about page of the Alepha SSR example application.",
      );
    });

    test("has correct page title", async ({ page }) => {
      await page.goto("/about");

      await expect(page).toHaveTitle("About");
    });
  });
});

test.describe("Counter Functionality", () => {
  /**
   * Helper to get the current count from the button.
   */
  async function getCount(page: Page) {
    const text = await page.locator("button").textContent();
    return parseInt(text!.replace("Click ", ""), 10);
  }

  /**
   * Wait for hydration by ensuring JS chunks are loaded and executed.
   */
  async function waitForHydration(page: Page) {
    // Wait for network to be idle (all resources including JS loaded)
    await page.waitForLoadState("networkidle");
    // Give React time to hydrate after script execution
    await page.waitForTimeout(500);
  }

  /**
   * Click and wait for count to change from initial value.
   */
  async function clickAndWaitForChange(page: Page, expectedCount: number) {
    const button = page.locator("button");
    await button.click();
    await expect(button).toHaveText(`Click ${expectedCount}`, {
      timeout: 10000,
    });
  }

  test("clicking button increments counter by 1", async ({ page }) => {
    await page.goto("/");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const button = page.locator("button");
    await expect(button).toBeVisible();

    await waitForHydration(page);

    const initialCount = await getCount(page);

    // Click and wait for count to change
    await clickAndWaitForChange(page, initialCount + 1);
  });

  test("multiple clicks increment counter by 1, 2, 3", async ({ page }) => {
    await page.goto("/");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const button = page.locator("button");
    await expect(button).toBeVisible();

    await waitForHydration(page);

    const initialCount = await getCount(page);

    // Click 1: increment by 1
    await clickAndWaitForChange(page, initialCount + 1);

    // Click 2: increment by 2 total
    await clickAndWaitForChange(page, initialCount + 2);

    // Click 3: increment by 3 total
    await clickAndWaitForChange(page, initialCount + 3);
  });
});

test.describe("SSR Hydration", () => {
  test("home page renders server-side content before hydration", async ({
    request,
  }) => {
    const response = await request.get("/");
    const html = await response.text();

    expect(html).toContain("Hello, Alepha SSR!");
    expect(html).toContain("Click");
    expect(html).toContain("Add ?name=your-name to URL");
  });

  test("home page with query param renders correct greeting server-side", async ({
    request,
  }) => {
    const response = await request.get("/?name=TestUser");
    const html = await response.text();

    expect(html).toContain("Hello, TestUser SSR!");
  });

  test("about page renders server-side content", async ({ request }) => {
    const response = await request.get("/about");
    const html = await response.text();

    expect(html).toContain("About Page");
    expect(html).toContain(
      "This is the about page of the Alepha SSR example application.",
    );
  });
});
