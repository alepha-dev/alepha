import { expect, test } from "@playwright/test";

test.describe("Form gallery index", () => {
  test("lists all 6 forms", async ({ page }) => {
    await page.goto("/demo/forms");
    for (const title of [
      "Login",
      "Register",
      "Address",
      "Payment",
      "Select variants",
      "File upload",
      "Date / time",
    ]) {
      await expect(page.getByRole("link", { name: title })).toBeVisible();
    }
  });
});

test.describe("Login form — autocomplete tokens", () => {
  test("email gets username + password gets current-password", async ({
    page,
  }) => {
    await page.goto("/demo/forms/login");
    await expect(page.locator('input[name="email"]')).toHaveAttribute(
      "autocomplete",
      "username",
    );
    await expect(page.locator('input[name="password"]')).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });
});

test.describe("Register form — autocomplete tokens", () => {
  test("name + email + tel + new-password tokens flow through", async ({
    page,
  }) => {
    await page.goto("/demo/forms/register");
    const cases = [
      ["firstName", "given-name"],
      ["lastName", "family-name"],
      ["email", "email"],
      ["username", "username"],
      ["phone", "tel"],
      ["password", "new-password"],
      ["confirm", "new-password"],
    ];
    for (const [name, token] of cases) {
      await expect(page.locator(`input[name="${name}"]`)).toHaveAttribute(
        "autocomplete",
        token,
      );
    }
  });
});

test.describe("Address form — address-* tokens", () => {
  test("country select renders", async ({ page }) => {
    await page.goto("/demo/forms/address");
    await expect(page.locator('input[name="street"]')).toHaveAttribute(
      "autocomplete",
      "address-line1",
    );
    await expect(page.locator('input[name="city"]')).toHaveAttribute(
      "autocomplete",
      "address-level2",
    );
    await expect(page.locator('input[name="postalCode"]')).toHaveAttribute(
      "autocomplete",
      "postal-code",
    );
  });
});

test.describe("Payment form — cc-* tokens", () => {
  test("card fields carry cc-* + placeholders", async ({ page }) => {
    await page.goto("/demo/forms/payment");
    await expect(page.locator('input[name="cardholder"]')).toHaveAttribute(
      "autocomplete",
      "cc-name",
    );
    await expect(page.locator('input[name="cardNumber"]')).toHaveAttribute(
      "autocomplete",
      "cc-number",
    );
    await expect(page.locator('input[name="cardNumber"]')).toHaveAttribute(
      "placeholder",
      "1234 5678 9012 3456",
    );
    await expect(page.locator('input[name="expiry"]')).toHaveAttribute(
      "autocomplete",
      "cc-exp",
    );
    await expect(page.locator('input[name="cvc"]')).toHaveAttribute(
      "autocomplete",
      "cc-csc",
    );
  });
});

test.describe("ControlSelect variants", () => {
  test("native select for short enum", async ({ page }) => {
    await page.goto("/demo/forms/selects");
    await expect(page.getByText("Fruit (enum)")).toBeVisible();
    // native select trigger has role=combobox in radix
    await expect(
      page.getByRole("combobox").filter({ hasText: "apple" }),
    ).toBeVisible();
  });

  test("rich items popover shows tag + description", async ({ page }) => {
    await page.goto("/demo/forms/selects");
    // Color trigger has id ending in "-color"
    await page.locator('[id$="-color"]').first().click();
    await expect(page.getByText("WARM").first()).toBeVisible();
    await expect(page.getByText("Warm, energetic")).toBeVisible();
  });

  test("createNewEntry adds the typed value", async ({ page }) => {
    await page.goto("/demo/forms/selects");
    await page.locator('[id$="-tags"]').first().click();
    await page.getByPlaceholder("Search…").fill("docker");
    await page.getByRole("option", { name: /Create "docker"/ }).click();
    await expect(page.locator('[id$="-tags"]').first()).toContainText("docker");
  });
});

test.describe("Date / time control", () => {
  test("date picker pops a calendar grid", async ({ page }) => {
    await page.goto("/demo/forms/dates");
    // The Birthday button is the popover trigger with id ending in -birthday
    await page.locator('[id$="-birthday"]').click();
    await expect(page.getByRole("grid")).toBeVisible();
    await expect(page.getByText("Su").first()).toBeVisible();
  });

  test("time-only field renders a native time input", async ({ page }) => {
    await page.goto("/demo/forms/dates");
    await expect(
      page.locator('input[name="alarm"][type="time"]'),
    ).toBeVisible();
  });
});
