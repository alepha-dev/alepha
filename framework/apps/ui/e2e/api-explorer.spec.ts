import { expect, test } from "@playwright/test";

/**
 * The API explorer over the site's own OpenAPI document (`/docs/json`, from
 * `ShowcaseOpenApi`). The unit specs render the views from a literal
 * document; this one proves the built app serves the document, the page reads
 * it in the browser, and the operations of the real controllers show up.
 */
test.describe("API explorer", () => {
  test("lists the showcase operations, searches, and opens one", async ({
    page,
  }) => {
    await page.goto("/pages/developer/api");

    await expect(
      page.getByRole("heading", { name: "Alepha UI showcase" }),
    ).toBeVisible();
    await expect(page.getByText("/api/showcase/members").first()).toBeVisible();

    await page.getByRole("searchbox").fill("patch users");
    const results = page.locator("nav button", { hasText: "/api/admin/users" });
    await expect(results).toHaveCount(1);
    await results.click();

    const detail = page.locator("article");
    await expect(detail.getByText("/api/admin/users/{id}")).toBeVisible();
    await expect(detail.getByText("Action")).toBeVisible();
    await expect(page).toHaveURL(/#/);
  });

  test("serves the OpenAPI document with Alepha's extensions", async ({
    request,
  }) => {
    const res = await request.get("/docs/json");
    expect(res.ok()).toBe(true);
    const doc = await res.json();
    const op = doc.paths["/api/showcase/members"].get;
    expect(op["x-alepha-action"]).toEqual({
      name: "findShowcaseMembers",
      group: "ShowcaseController",
    });
  });
});
