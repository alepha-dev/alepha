import { expect, test } from "./_fixtures.ts";
import { registerAndVerify, signInAsAdmin } from "./_helpers.ts";

/**
 * Admin user-detail page (`/admin/users/:id`).
 *
 * Covers the full set of edit / validation / conflict cases that the
 * AutoForm-backed Profile section is expected to handle, plus
 * server-side guards (email-changed → emailVerified=false, unique
 * conflicts → friendly 409).
 *
 * The admin account is registered once by `e2e/global-setup.ts` and
 * auto-promoted on first login, because `playwright.config.ts` passes its
 * address as `ADMIN_EMAIL` to the webServer — the realm `adminEmails`
 * setting then matches it and grants the `admin` role.
 */
test.describe("admin user detail", () => {
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

    // 1. Register two ordinary users — the victim we will edit, and a
    //    second account whose email/username we will collide with.
    await registerAndVerify(page, victimEmail, "GoodPassw0rd");
    await page.goto("/auth/logout");
    await page.waitForLoadState("domcontentloaded");

    await registerAndVerify(page, otherEmail, "GoodPassw0rd");
    await page.goto("/auth/logout");
    await page.waitForLoadState("domcontentloaded");

    // 2. Sign in as admin. The account is created once by `global-setup.ts`;
    //    signing in through the form is what grants the role.
    await signInAsAdmin(page);

    // 3. Resolve the victim's user id via the admin list endpoint.
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

    // 4. Open the detail page for the victim.
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
    // No `.first()`, on purpose: strict mode makes this fail if the refusal
    // reaches the screen more than once. It used to - the page toasted the
    // message itself and then rethrew, and `ActionErrorToaster` turned the
    // rethrow into a second, identical toast. The handler now only throws.
    await expect(page.getByText(/email already exists/i)).toBeVisible({
      timeout: 5_000,
    });
    await page.locator('input[name="email"]').fill(victim!.email);

    // -- toast error on duplicate username ----------------------------
    await page.locator('input[name="username"]').fill(other!.username ?? "");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/username already exists/i)).toBeVisible({
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

  /**
   * Navigating AWAY from the page must not fire `getUser` with an empty id.
   *
   * Blight #358 on `shop-production`, seven hits, and #118 before it on the
   * previous bundle. The reported stack points at `CodecManager.encode` and
   * reads like a response-serialisation failure; it is not. `$action.run()`
   * encodes the REQUEST through the same codec before validating it, so
   * `Invalid GUID at /id` is `params.id` failing `z.uuid()`.
   *
   * `resolveUserDetailId` falls back to `""` on purpose, so a vendored
   * consumer declaring `/users/:id` keeps working. What was missing is the
   * gate: `useRouterState` is a global store, so leaving the page re-renders
   * this component with the NEXT route's params before it unmounts, `userId`
   * becomes `""`, the dep changes, and the query re-runs with it.
   *
   * Asserted on the REQUEST rather than on a failure, because the call goes
   * through `/api/_batch`, which catches per-entry errors and answers 200. A
   * test waiting for a red response would pass while the bug was live.
   */
  test("leaving the page issues no request with an empty user id", async ({
    page,
  }) => {
    const stamp = Date.now();
    await registerAndVerify(
      page,
      `bystander-${stamp}@example.com`,
      "GoodPassw0rd",
    );
    await page.goto("/auth/logout");
    await page.waitForLoadState("domcontentloaded");
    await signInAsAdmin(page);

    const usersJson = await page.evaluate(async () => {
      const res = await fetch("/api/users?size=100");
      return res.json();
    });
    type ListedUser = { id: string; email: string };
    const users: ListedUser[] = usersJson.content ?? usersJson;
    const victim = users.find((u) => u.email?.startsWith(`bystander-${stamp}`));
    expect(victim, "the seeded user must be listed").toBeTruthy();

    const emptyIdCalls: string[] = [];
    page.on("request", (request) => {
      const body = request.postData();
      if (!body) return;
      // Both shapes: the batched envelope and a direct action call.
      if (!/getUser|findIdentities/.test(body)) return;
      if (/"id"\s*:\s*""|"userId"\s*:\s*""/.test(body)) {
        emptyIdCalls.push(`${request.url()} ${body.slice(0, 300)}`);
      }
    });

    await page.goto(`/admin/users/${victim!.id}`);
    await expect(
      page.getByText(`bystander-${stamp}@example.com`).first(),
    ).toBeVisible({ timeout: 15_000 });

    // ⚠️ CLIENT-SIDE navigation, not `page.goto`. A `goto` is a full document
    // load: the old component never re-renders, so the outgoing render this
    // is about cannot happen and the test passes with or without the fix.
    // Only an in-app link keeps React mounted across the params change.
    // Arriving is a full load; LEAVING is the click. Repeated three times
    // because the empty id rides one render, and a single sample of a
    // timing-dependent render is a coin toss reported as a result.
    const usersLink = page.getByRole("link", { name: /^users$/i }).first();
    for (let n = 0; n < 3; n++) {
      await usersLink.click();
      await expect(page).toHaveURL(/\/admin\/users\/?$/, { timeout: 15_000 });
      await page.waitForLoadState("networkidle");

      await page.goto(`/admin/users/${victim!.id}`);
      await expect(
        page.getByText(`bystander-${stamp}@example.com`).first(),
      ).toBeVisible({ timeout: 15_000 });
    }
    await usersLink.click();
    await expect(page).toHaveURL(/\/admin\/users\/?$/, { timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    expect(emptyIdCalls, emptyIdCalls.join("\n")).toEqual([]);
  });
});
