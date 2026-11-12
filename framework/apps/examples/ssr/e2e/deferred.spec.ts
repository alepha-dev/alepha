import { expect, test } from "./fixtures.ts";

/**
 * A deferred loader value in a real browser, on the runtime the build targets
 * (the `prod` project is workerd, through `wrangler dev`).
 *
 * jsdom cannot answer what this is here for: whether `hydrateRoot` holds up
 * while Fizz is still appending to the element it hydrates.
 *
 * ⚠️ `identity`, because `wrangler dev` gzips a response with no flush, which
 * delivers a stream in one piece at its end. The edge does not do that.
 */
test.describe("Deferred loader data", () => {
  test.use({ extraHTTPHeaders: { "accept-encoding": "identity" } });

  test("the shell leaves before the value is ready", async ({ baseURL }) => {
    const response = await fetch(`${baseURL}/deferred?ms=1500`, {
      headers: { "accept-encoding": "identity" },
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const start = performance.now();

    let html = "";
    let shellAt = 0;
    let valueAt = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      shellAt ||= html.includes("Deferred shell") ? performance.now() : 0;
      valueAt ||= html.includes("__alephaDeferred") ? performance.now() : 0;
    }

    expect(shellAt).toBeGreaterThan(0);
    expect(valueAt).toBeGreaterThan(0);
    expect(valueAt - shellAt).toBeGreaterThan(1000);
    expect(shellAt - start).toBeLessThan(1000);
  });

  test("hydrates and answers clicks while the value is pending", async ({
    page,
  }, testInfo) => {
    // Vite's entry stays a deferred module, since React Refresh's preamble has
    // to run first, so `alepha dev` hydrates at the end of the document.
    test.skip(testInfo.project.name === "dev", "a built entry is async");

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto("/deferred?ms=3000", { waitUntil: "commit" });

    const button = page.getByRole("button");
    await expect(button).toBeVisible();
    await expect(page.locator("#pending")).toBeVisible();

    await expect
      .poll(async () => {
        await button.click();
        return button.textContent();
      })
      .not.toBe("Clicked 0");
    await expect(page.locator("#pending")).toBeVisible();

    const clicks = await button.textContent();
    await expect(page.locator("#value")).toHaveText("Deferred value", {
      timeout: 10_000,
    });
    await expect(page.locator("#pending")).toHaveCount(0);
    await expect(button).toHaveText(clicks as string);

    await button.click();
    await expect(button).not.toHaveText(clicks as string);
    expect(errors).toEqual([]);
  });

  test("a value settled before the shell reads at once", async ({ page }) => {
    await page.goto("/deferred?ms=0");

    await expect(page.locator("#value")).toHaveText("Deferred value");
    await page.getByRole("button").click();
    await expect(page.getByRole("button")).toHaveText("Clicked 1");
  });

  test("a client navigation renders the page and suspends", async ({
    page,
  }) => {
    await page.goto("/about");
    await page.waitForLoadState("networkidle");

    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "/deferred?ms=1500";
      document.body.appendChild(link);
      link.click();
    });

    await expect(page.locator("h1")).toHaveText("Deferred shell");
    await expect(page.locator("#pending")).toBeVisible();
    await expect(page.locator("#value")).toHaveText("Deferred value", {
      timeout: 10_000,
    });
  });

  test("a rejected value reaches errorHandler with its status", async ({
    page,
  }) => {
    await page.goto("/deferred?ms=200&fail=true");

    await expect(page.locator("#failed")).toHaveText("No such value", {
      timeout: 10_000,
    });
  });
});
