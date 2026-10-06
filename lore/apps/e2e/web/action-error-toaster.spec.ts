import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  createProjectViaWizard,
  registerAndVerify,
  submitSignInForm,
} from "./_helpers.ts";

/**
 * One `ActionErrorToaster`, mounted at Lore's root (#Q2317).
 *
 * The first Lore e2e that makes the server fail on purpose. Everything else
 * in #E59 moves hand-written `try/catch + toaster.error` onto `useAction`,
 * `useQuery` and `useForm`, and those only ever reach the user through this
 * listener. Lore had none: `ProjectView`'s shell is `embedded`, which mounts
 * no toaster, so a failed managed request was silent on every page.
 *
 * Counting the toasts is the point. Zero is the bug this quest fixes; two is
 * the one it could introduce, from a call site that toasts by hand and
 * rethrows, or a second listener.
 */
test.describe("action error toaster", () => {
  /**
   * Answers every non-GET call to one action with `status` and `message`, in
   * the framework's own error shape so the client decodes it as an
   * `HttpError`. Matched on the action's path from `apiLinks`, so a direct
   * call is caught; a click sends one write alone, which never batches.
   */
  const failAction = async (
    page: Page,
    action: string,
    status: number,
    message: string,
  ): Promise<void> => {
    const path = await apiPath(page, action);
    const pattern = new RegExp(
      `^${path.replace(/:[^/]+/g, "[^/]+").replace(/\//g, "\\/")}$`,
    );
    await page.route(
      (url) => pattern.test(url.pathname),
      async (route) => {
        if (route.request().method() === "GET") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ error: "E2eError", status, message }),
        });
      },
    );
  };

  const toasts = (page: Page, message: string) =>
    page.locator("[data-sonner-toast]", { hasText: message });

  /**
   * Exactly one, and still one a moment later: a second listener or a hand
   * toast lands in the same tick as the first, so a count read the instant
   * the first appears could miss it.
   */
  const expectOneToast = async (page: Page, message: string) => {
    await expect(toasts(page, message)).toHaveCount(1, { timeout: 15_000 });
    await page.waitForTimeout(750);
    await expect(toasts(page, message)).toHaveCount(1);
  };

  test("a failed write on /account toasts once", async ({ page }) => {
    test.setTimeout(90_000);

    await registerAndVerify(
      page,
      `aet-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    await page.goto("/account");
    await page.waitForLoadState("networkidle");

    const message = "Profile store unavailable (e2e)";
    await failAction(page, "updateMyProfile", 500, message);

    await page.getByLabel("First name").fill("Ada");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expectOneToast(page, message);
    await expect(page.getByText(/profile updated/i)).toHaveCount(0);
  });

  test("a failed write on a project page toasts once", async ({ page }) => {
    test.setTimeout(120_000);

    await registerAndVerify(
      page,
      `aet-p-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    const { slug } = await createProjectViaWizard(
      page,
      `Toast${Date.now()}`.slice(0, 20),
    );
    await page.goto(`/${slug}/epics`);
    await page.waitForLoadState("networkidle");

    const message = "Epic store unavailable (e2e)";
    await failAction(page, "createEpic", 500, message);

    await page.getByRole("button", { name: "New Epic" }).first().click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await modal.getByRole("textbox").first().fill("Never saved");
    await modal.getByRole("button", { name: "Create Epic" }).click();

    await expectOneToast(page, message);
    // Refused, so the dialog holds what was typed.
    await expect(modal).toBeVisible();
  });

  /**
   * `ProjectCreate`'s form toasts `error.message` in its own `onError`, then
   * puts the wizard back a step. `/new-project` renders no shell, so before
   * #Q2345 marked that error handled, a root listener toasted it a second time.
   */
  test("a refused project creation toasts once and returns to the last step", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await registerAndVerify(
      page,
      `aet-n-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    await page.goto("/new-project");
    await page.waitForLoadState("networkidle");

    const message = "Project cap reached (e2e)";
    await failAction(page, "createProject", 409, message);

    await page
      .locator('input[type="text"]')
      .first()
      .fill(`Capped${Date.now()}`.slice(0, 20));
    await page.getByRole("button", { name: /^next$/i }).click();
    await page.getByRole("button", { name: /^next$/i }).click();
    await page.getByRole("button", { name: /create project/i }).click();

    await expectOneToast(page, message);
    await expect(
      page.getByRole("button", { name: /create project/i }),
    ).toBeVisible();
  });

  /**
   * `AuthLogin` turns the password grant's 401 into a `FormValidationError` on
   * `/password`, shown under the field, and its form passes `onError` because
   * the page renders every error it throws. It used to match the 401 on a class
   * name the wire never carries, so the refusal reached the form's alert as
   * "Invalid credentials", and would have toasted beside it once this listener
   * existed.
   */
  test("a wrong password shows under the field and does not toast", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `aet-l-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    await page.context().clearCookies();

    await page.goto("/auth/login");
    await submitSignInForm(page, email, "WrongPassw0rd");

    await expect(page.getByText("Invalid identifier or password")).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(750);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });
});
