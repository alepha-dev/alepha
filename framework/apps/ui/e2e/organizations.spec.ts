import { expect, test } from "@playwright/test";

test.describe("organization pages", () => {
  test("walks organizations, members, invitations, and ranks", async ({
    page,
  }) => {
    await page.goto("/pages/organizations");
    await expect(
      page.getByRole("heading", { name: "Organizations" }),
    ).toBeVisible();
    await expect(page.getByText("Analytical Engines")).toBeVisible();

    await page.getByRole("button", { name: "Open Analytical Engines" }).click();
    await expect(page).toHaveURL(/\/pages\/organizations\/members/);
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expect(page.getByText("charles@alepha.dev")).toBeVisible();

    await page.getByRole("button", { name: "Invite member" }).click();
    await expect(
      page.getByRole("dialog").getByText("Invite a member"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.goto("/pages/organizations/invitations");
    await expect(page.getByText("Difference Lab")).toBeVisible();

    await page.goto("/pages/organizations/ranks");
    await expect(page.getByText("Maintainer").first()).toBeVisible();
    await expect(page.getByText("member:manage").first()).toBeVisible();
  });
});
