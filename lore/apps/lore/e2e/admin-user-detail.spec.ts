import { expect, test } from "@playwright/test";

import { registerAndVerify } from "./_helpers.ts";

/**
 * Admin user-detail page (`/admin/users/:id`).
 *
 * Covers the full set of edit / validation / conflict cases that the
 * AutoForm-backed Profile section is expected to handle, plus
 * server-side guards (email-changed → emailVerified=false, unique
 * conflicts → friendly 409).
 *
 * The admin account is auto-promoted on first login because
 * `playwright.config.ts` sets `ADMIN_EMAIL=admin@example.com` for the
 * webServer — the realm `adminEmails` setting then matches the
 * registered user and grants the `admin` role.
 */
test.describe("admin user detail", () => {
  const adminEmail = "admin@example.com";
  const adminPassword = "GoodPassw0rd";

  // Un-skipped 2026-08-27. It had been skipped since 2026-05-28 under two
  // successive wrong diagnoses; what it was catching all along is a real
  // `keepDirty` bug, now fixed in `FormModel.setInitialValues`.
  //
  // The trap: the clear at "can remove firstName + lastName" puts `lastName`
  // back to the "" it held before the previous save, and `keepDirty` decided
  // "edited" by comparing the value against exactly that baseline. So the
  // user's clear was indistinguishable from an untouched field, the refetch
  // put "Smith" back, the form went pristine, and a Save button gated on
  // `dirty` never enabled again.
  //
  // The last note blamed a hung `userQuery.refetch()`, on the evidence of a
  // Save button reading `aria-busy="true"`. Instrumenting the run showed the
  // refetch completing normally every time: that attribute was a transient
  // state Playwright happened to sample, and the button stayed disabled
  // afterwards because the form was pristine, not because it was loading.
  // See `useForm-keep-dirty.browser.spec.tsx` for the unit-level case.
  test("profile edit / validation / conflicts", async ({ page }) => {
    const stamp = Date.now();
    const victimEmail = `victim-${stamp}@example.com`;
    const otherEmail = `other-${stamp}@example.com`;

    // 1. Register the soon-to-be admin first (login bumps the admin role).
    await registerAndVerify(page, adminEmail, adminPassword);
    // Force a fresh sign-in so the role-promotion path fires (registration
    // already logged them in once, but the slug-derived role refresh
    // happens on every login, not on register).
    await page.goto("/auth/logout");
    await page.waitForLoadState("domcontentloaded");

    // 2. Register two ordinary users — the victim we will edit, and a
    //    second account whose email/username we will collide with.
    await registerAndVerify(page, victimEmail, "GoodPassw0rd");
    await page.goto("/auth/logout");
    await page.waitForLoadState("domcontentloaded");

    await registerAndVerify(page, otherEmail, "GoodPassw0rd");
    await page.goto("/auth/logout");
    await page.waitForLoadState("domcontentloaded");

    // 3. Sign in as admin via the login form so admin role is granted.
    await page.goto("/auth/login");
    await page
      .getByRole("textbox", { name: /identifier|email/i })
      .first()
      .fill(adminEmail);
    await page
      .getByRole("textbox", { name: /password/i })
      .first()
      .fill(adminPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/^http:\/\/[^/]+\/$/, { timeout: 15_000 });

    // 4. Resolve the victim's user id via the admin list endpoint.
    const usersJson = await page.evaluate(async () => {
      const res = await fetch("/api/users?size=100");
      return res.json();
    });
    type ListedUser = { id: string; email: string; username?: string };
    const users = usersJson.content as ListedUser[];
    const victim = users.find((u) => u.email === victimEmail);
    const other = users.find((u) => u.email === otherEmail);
    expect(victim, "victim should be findable").toBeTruthy();
    expect(other, "other user should be findable").toBeTruthy();

    // 5. Open the detail page for the victim.
    await page.goto(`/admin/users/${victim!.id}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator('input[name="username"]')).toHaveValue(
      victim!.username ?? "",
    );

    // -- toast on success + change firstName --------------------------
    await page.locator('input[name="firstName"]').fill("Alice");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText("Profile saved")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('input[name="firstName"]')).toHaveValue("Alice");

    // -- can remove firstName + lastName ------------------------------
    await page.locator('input[name="firstName"]').fill("");
    await page.locator('input[name="lastName"]').fill("Smith");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText("Profile saved").last()).toBeVisible();
    await expect(page.locator('input[name="firstName"]')).toHaveValue("");
    await expect(page.locator('input[name="lastName"]')).toHaveValue("Smith");

    await page.locator('input[name="lastName"]').fill("");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.locator('input[name="lastName"]')).toHaveValue("");

    // -- reset button restores the loaded-user snapshot ---------------
    await page.locator('input[name="firstName"]').fill("DIRTY");
    await page.getByRole("button", { name: /^reset$/i }).click();
    await expect(page.locator('input[name="firstName"]')).toHaveValue("");

    // -- can't remove username ----------------------------------------
    // This realm is `username: "email"` — the slug is derived at signup
    // rather than demanded of the admin, so a blank one is refused as
    // "cannot be removed", not as "required".
    await page.locator('input[name="username"]').fill("");
    await page.getByRole("button", { name: /save changes/i }).click();
    // Twice on screen: the inline field error and the toast. Either proves
    // the refusal, so the assertion picks one rather than demanding one.
    await expect(
      page.getByText(/username cannot be removed/i).first(),
    ).toBeVisible();
    // Re-fill so subsequent tests aren't blocked by validation.
    await page.locator('input[name="username"]').fill(victim!.username ?? "");

    // -- can't remove email (required) --------------------------------
    await page.locator('input[name="email"]').fill("");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/email is required/i).first()).toBeVisible();
    await page.locator('input[name="email"]').fill(victim!.email);

    // -- toast error on duplicate email -------------------------------
    await page.locator('input[name="email"]').fill(otherEmail);
    await page.getByRole("button", { name: /save changes/i }).click();
    // `.first()`: the page toasts the friendly message itself AND rethrows,
    // which the framework's ActionErrorToaster turns into a second toast of
    // the same text. One is enough to prove the refusal reached the user.
    await expect(page.getByText(/email already exists/i).first()).toBeVisible({
      timeout: 5_000,
    });
    await page.locator('input[name="email"]').fill(victim!.email);

    // -- toast error on duplicate username ----------------------------
    await page.locator('input[name="username"]').fill(other!.username ?? "");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(
      page.getByText(/username already exists/i).first(),
    ).toBeVisible({
      timeout: 5_000,
    });
    await page.locator('input[name="username"]').fill(victim!.username ?? "");

    // -- can change email + emailVerified auto-flipped to false -------
    const newEmail = `victim-${stamp}-renamed@example.com`;
    await page.locator('input[name="email"]').fill(newEmail);
    await page.getByRole("button", { name: /save changes/i }).click();

    // Polled rather than read once after the toast. "Profile saved" is not a
    // reliable "this save has landed" signal: `.last()` matches a toast an
    // EARLIER save left on screen, and the read then raced the write it was
    // supposed to observe.
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              fetch(`/api/users/${id}`)
                .then((r) => r.json())
                .then((u) => ({
                  email: u.email,
                  emailVerified: u.emailVerified,
                })),
            victim!.id,
          ),
        { timeout: 10_000 },
      )
      .toEqual({ email: newEmail, emailVerified: false });
  });
});
