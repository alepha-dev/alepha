import { expect, test } from "@playwright/test";

test.describe("sign-in through an external identity provider", () => {
  test("a guarded page sends an anonymous visitor to sign in", async ({
    page,
  }) => {
    await page.goto("/profile");

    await expect(page).toHaveURL(/\/login\?redirect=%2Fprofile$/);
    await expect(
      page.getByRole("button", { name: "Sign in with Keycloak" }),
    ).toBeVisible();
  });

  test("signs in, reads the profile, and signs out", async ({
    page,
    context,
  }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: "Sign in with Keycloak" }).click();

    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByTestId("name")).toHaveText("Ada Lovelace");
    await expect(page.getByTestId("email")).toHaveText("ada@example.com");
    await expect(page.getByTestId("sub")).toHaveText("ada");

    const cookies = await context.cookies();
    const session = cookies.find((it) => it.name.endsWith(".tokens"));
    expect(session?.httpOnly).toBe(true);

    await page.goto("/");
    await expect(page.getByTestId("greeting")).toHaveText(
      "Signed in as Ada Lovelace",
    );

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByTestId("greeting")).toHaveText(
      "Nobody is signed in.",
    );
    expect(
      (await context.cookies()).some((it) => it.name.endsWith(".tokens")),
    ).toBe(false);

    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login\?redirect=%2Fprofile$/);
  });
});
