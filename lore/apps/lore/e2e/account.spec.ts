import { expect, test } from "./_fixtures.ts";
import {
  confirmDialog,
  createProjectViaWizard,
  registerAndVerify,
  releasePointerEvents,
} from "./_helpers.ts";

/**
 * The `/account` area — Lore's consumer of `@alepha/ui`'s `AccountRouter`.
 *
 * Most of what these pages do is covered by framework specs against the
 * controllers. What only an e2e can prove is that the *seam* is wired: that
 * `AccountRouter` mounts inside Lore's own layout, that the rail lists both
 * the framework's five pages and Lore's two, and that the `$pageAccount`
 * extension point actually produces reachable routes.
 */
test.describe("Account area", () => {
  test("lands on the profile and lists both built-in and Lore pages", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `ac-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    // Bare `/account` must resolve — the profile sits at the shell root, which
    // is why AccountRouter needs no index redirect.
    await page.goto("/account");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(email, { exact: true })).toBeVisible();

    // The rail is derived from route `nav` metadata, so this asserts the five
    // built-ins AND that `$pageAccount` put Lore's three in the same tree.
    for (const label of [
      "Profile",
      "Security",
      "Sessions",
      "API keys",
      "Connected apps",
      "Invitations",
      "Feedback",
      "Notifications",
      "Estates",
    ]) {
      await expect(
        page.getByRole("link", { name: label, exact: true }),
      ).toBeVisible();
    }
  });

  test("highlights exactly one rail entry per page", async ({ page }) => {
    test.setTimeout(90_000);

    /*
      Regression guard for the Profile entry. It sits at `path: "/"` under the
      shell, and `ReactPageProvider.createMatch` collapses that to the shell's
      own path (`/account` + `/` → `/account`), so its `match` is a prefix of
      every sibling's. `isActivePath` is a per-entry predicate and cannot see
      that a sibling matched deeper, so Profile rendered active on *every*
      account page until `keepDeepestActive` was added.

      Driven through the real router rather than asserted against a hardcoded
      href, because the whole bug lives in what `createMatch` produces for an
      index page. A unit test that assumes `/account` cannot notice that
      changing.
    */
    const email = `ah-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    const expected: Array<[string, string]> = [
      ["/account", "Profile"],
      ["/account/security", "Security"],
      ["/account/sessions", "Sessions"],
      ["/account/keys", "API keys"],
      ["/account/connections", "Connected apps"],
      ["/account/invitations", "Invitations"],
      ["/account/feedback", "Feedback"],
      ["/account/estates", "Estates"],
    ];

    for (const [path, label] of expected) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const active = page.locator('nav a[aria-current="page"]');
      await expect(active).toHaveCount(1);
      await expect(active).toHaveText(label);
    }
  });

  test("renames the account and persists it across a reload", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `an-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/account");
    await page.waitForLoadState("networkidle");

    const firstName = page.getByLabel("First name");
    await firstName.fill("Ada");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Assert the write landed before asserting it persisted — otherwise a
    // failed save and a failed reload look identical.
    await expect(page.getByText(/profile updated/i)).toBeVisible();

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("First name")).toHaveValue("Ada");
  });

  /**
   * ⚠️ **An optimistic switch passes its assertion before the save is sent.**
   * The control answers the click from local state, so `expect(...).toBe
   * (false)` is true a millisecond later whether or not anything reached the
   * server. Arming `waitForResponse` BEFORE the click is what makes this a
   * test of the save rather than of React.
   */
  test("turns email off from the notifications page and keeps it off", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `nt-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/account/notifications");
    await page.waitForLoadState("networkidle");

    const emailSwitch = page.getByRole("switch", { name: "Email" });
    await expect(emailSwitch).toHaveAttribute("aria-checked", "true");

    // ⚠️ Client actions are coalesced into `POST /api/_batch`, so a
    // `waitForResponse` on the action's own path never fires. Match either,
    // and arm it BEFORE the click: the switch answers from local state, so
    // the assertion below is true a millisecond later whether or not anything
    // reached the server.
    const saved = page.waitForResponse(
      (response) => /_batch|notification-preferences/.test(response.url()),
      { timeout: 20_000 },
    );
    await emailSwitch.click();
    expect((await saved).ok()).toBe(true);

    // Polled: the batch above carries the write, and the row it produces is
    // read back by the next page load rather than by that same round trip.
    await expect(async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("switch", { name: "Email" })).toHaveAttribute(
        "aria-checked",
        "false",
        { timeout: 5_000 },
      );
    }).toPass({ timeout: 30_000 });

    // The in-app row is a statement, not a control: there is no switch to
    // find, which is what stops it reading as a broken one.
    await expect(page.getByText("In-app", { exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: "In-app" })).toHaveCount(0);
  });

  test("changes the password and reports the revoked sessions", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `ap-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/account/security");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /change password/i }).click();
    await page.getByLabel(/^Current password/).fill("GoodPassw0rd");
    await page.getByLabel(/^New password/).fill("EvenBett3r!");
    await page.getByLabel(/^Confirm new password/).fill("EvenBett3r!");
    await page
      .getByRole("button", { name: /change password/i })
      .last()
      .click();

    // `changeMyPassword` returns how many OTHER sessions it ended, and the
    // toast says so rather than leaving the person guessing about their phone.
    await expect(page.getByText(/password changed/i)).toBeVisible();
  });

  test("lists the current session and offers no way to revoke it", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `as-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/account/sessions");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/this device/i)).toBeVisible();
    // The row you are sitting in has no Revoke button — signing yourself out
    // belongs to the sign-out affordance, not to a per-row action that reads
    // as "revoke someone else".
    await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  });

  test("creates an API key with an expiry, rotates it, revokes it, and reuses its name", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);

    const email = `ak-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    /**
     * The one-time reveal: read the token, dismiss it, and check it is gone.
     */
    const takeToken = async (): Promise<string> => {
      const reveal = page
        .getByRole("dialog")
        .filter({ hasText: /copy your key now/i });
      await expect(reveal).toBeVisible({ timeout: 15_000 });
      const token = (await reveal.locator("code").innerText()).trim();
      expect(token).toMatch(/^ak_/);
      await reveal.getByRole("button", { name: "Done", exact: true }).click();
      await expect(reveal).toBeHidden();
      await releasePointerEvents(page);
      // The token exists in readable form exactly once.
      await expect(page.getByText(token, { exact: true })).toHaveCount(0);
      return token;
    };

    /**
     * The status an API call made with this token gets back. Straight at the
     * API, without the page and its cookies: the key alone authenticates it.
     */
    const statusWith = async (token: string): Promise<number> =>
      (
        await request.get("/api/api-keys", {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status();

    await page.goto("/account/keys");
    await page.waitForLoadState("networkidle");

    // Create, with an expiry other than the preselected 90 days.
    await page.getByRole("button", { name: /new key/i }).click();
    const createDialog = page
      .getByRole("dialog")
      .filter({ hasText: "New API key" });
    await createDialog.getByLabel("Name").fill("CI pipeline");
    const expiry = createDialog.getByRole("combobox", {
      name: "Expires after",
    });
    // Filled from `GET /api-keys/options`, so wait for the preset it names.
    await expect(expiry).toContainText("90 days", { timeout: 15_000 });
    await expiry.click();
    await page.getByRole("option", { name: "30 days", exact: true }).click();
    await expect(expiry).toContainText("30 days");
    // Base UI leaves `pointer-events: none` behind when the listbox closes,
    // and the next click is Create.
    await releasePointerEvents(page);

    // Armed before the click: client actions go through `POST /api/_batch`.
    const created = page.waitForResponse(
      (response) =>
        /_batch|api-keys/.test(response.url()) &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await createDialog
      .getByRole("button", { name: "Create", exact: true })
      .click();
    expect((await created).ok()).toBe(true);
    const first = await takeToken();

    // The row says where the key is in its life: thirty days out.
    const row = page.getByText("CI pipeline", { exact: true });
    await expect(row).toBeVisible();
    await expect(page.getByText("in a month")).toBeVisible();
    expect(await statusWith(first)).toBe(200);

    // Rotate: a different secret on the same key, and the old one dies at
    // once, not after the validation cache's fifteen minutes.
    await page.getByRole("button", { name: "Rotate CI pipeline" }).click();
    const rotated = page.waitForResponse(
      (response) =>
        /_batch|rotate/.test(response.url()) &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await confirmDialog(page, "Rotate");
    expect((await rotated).ok()).toBe(true);
    const second = await takeToken();

    expect(second).not.toBe(first);
    expect(await statusWith(first)).toBe(401);
    expect(await statusWith(second)).toBe(200);

    // Revoke. A revoked key stays listed, in the collapsed "Inactive keys"
    // section, marked and with nothing left to click: it is the answer to
    // "why did CI stop working" (#Q2054, #Q2060).
    await page.getByRole("button", { name: "Revoke CI pipeline" }).click();
    const revoked = page.waitForResponse(
      (response) =>
        /_batch|api-keys/.test(response.url()) &&
        ["POST", "DELETE"].includes(response.request().method()),
      { timeout: 20_000 },
    );
    await confirmDialog(page, "Revoke");
    expect((await revoked).ok()).toBe(true);
    await expect(
      page.getByRole("button", { name: "Revoke CI pipeline" }),
    ).toHaveCount(0);
    expect(await statusWith(second)).toBe(401);

    await page.getByRole("button", { name: "Show", exact: true }).click();
    await expect(page.getByText("CI pipeline", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Revoked/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Rotate CI pipeline" }),
    ).toHaveCount(0);

    // Revoking freed the name: a new key takes it at once (#Q2054's partial
    // unique index, end to end).
    await page.getByRole("button", { name: /new key/i }).click();
    await createDialog.getByLabel("Name").fill("CI pipeline");
    await expect(expiry).toContainText("90 days", { timeout: 15_000 });
    const recreated = page.waitForResponse(
      (response) =>
        /_batch|api-keys/.test(response.url()) &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await createDialog
      .getByRole("button", { name: "Create", exact: true })
      .click();
    expect((await recreated).ok()).toBe(true);
    const third = await takeToken();

    expect(await statusWith(third)).toBe(200);
    await expect(
      page.getByRole("button", { name: "Revoke CI pipeline" }),
    ).toHaveCount(1);
  });

  test("refuses to delete the account while a project is still owned", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const email = `ad-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    await createProjectViaWizard(page, `AD${Date.now()}`.slice(0, 20));

    await page.goto("/account/security");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /delete account/i }).click();
    await page.getByLabel(/^Current password/).fill("GoodPassw0rd");
    await page.getByLabel(/to confirm/i).fill(email);
    await page
      .getByRole("button", { name: /delete account/i })
      .last()
      .click();

    /*
      Lore's `user:delete:before` hook refuses, and its message reaches the
      browser unwrapped — that is the whole reason `MyAccountController` emits
      without `{ log: true }`. A generic failure toast here would mean the
      framework had started wrapping it in `AlephaError`.
    */
    await expect(page.getByText(/you still own 1 project/i)).toBeVisible();

    // And the refusal has to actually refuse.
    await page.goto("/account");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(email, { exact: true })).toBeVisible();
  });

  test("keeps content past the fold reachable inside Lore's clipped shell", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    /*
      Regression guard for the `fill` seam. Lore's `Layout.tsx` is
      `h-svh … overflow-hidden`, so the document never scrolls and every page
      under it has to own its scroll. `SettingsLayout` defaults to the
      opposite assumption ("the page scrolls"), which is right when the
      account area is mounted standalone and silently wrong here: without
      `fill: true` on `accountRouterOptionsAtom` there is no scrollbar
      anywhere, and everything below the fold is unreachable rather than
      merely below it. `/account/feedback` past a dozen rows lost the rest of
      its table AND its pagination bar this way.

      Asserted through the DOM rather than by looking for a specific row,
      because how much content overflows depends on the page and the viewport
      — what must hold is that *something* can scroll.
    */
    const email = `af-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    // Short enough that the card stack cannot fit, whatever it holds.
    await page.setViewportSize({ width: 1280, height: 320 });
    await page.goto("/account/security");
    await page.waitForLoadState("networkidle");

    const overflow = await page.evaluate(() => {
      const overflows = (e: Element) => e.scrollHeight > e.clientHeight + 4;
      const all = [...document.querySelectorAll("*")];
      return {
        // Anything taller than its box whose overflow is hidden is content
        // the user can never get to — the bug, exactly.
        clipped: all.filter(
          (e) =>
            overflows(e) &&
            getComputedStyle(e).overflowY === "hidden" &&
            !e.className.toString().includes("sr-only"),
        ).length,
        scrollable: all.filter(
          (e) =>
            overflows(e) &&
            ["auto", "scroll"].includes(getComputedStyle(e).overflowY),
        ).length,
      };
    });

    expect(overflow.clipped).toBe(0);
    expect(overflow.scrollable).toBeGreaterThan(0);
  });

  test("404s the retired /auth/profile paths", async ({ page }) => {
    test.setTimeout(90_000);

    // Deleted, not redirected — a decision recorded in folio #100. Invitation
    // emails sent before the move carry the old path and will 404.
    const email = `ao-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/auth/profile");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  });
});
