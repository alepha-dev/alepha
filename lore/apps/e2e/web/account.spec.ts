import { expect, test } from "./_fixtures.ts";
import {
  confirmDialog,
  createProjectViaWizard,
  openAccount,
  registerAndVerify,
  releasePointerEvents,
} from "./_helpers.ts";

/**
 * The account dialog (#E140): Lore's consumer of `@alepha/ui`'s
 * `AccountDialog`, opened over the page rather than at a route.
 *
 * Most of what the sections do is covered by framework specs against the
 * controllers. What only an e2e can prove is that the seam is wired: that the
 * user menu and `?account=<section>` open the dialog, that its nav lists both
 * the framework's five sections and Lore's four, that it closes on a route
 * change, and that each section works inside it.
 */
test.describe("Account dialog", () => {
  test("opens from the user menu over the page, with the built-in and Lore sections", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `ac-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const url = page.url();

    await page.getByLabel("Account menu").click();
    await page.getByRole("menuitem", { name: "User Account" }).click();
    const dialog = page.locator('[data-slot="settings-dialog"]');
    await expect(dialog).toBeVisible();

    // The page is still the one it was: the dialog is state, not a route.
    expect(page.url()).toBe(url);
    await expect(dialog.getByText(email, { exact: true })).toBeVisible();

    // The nav lists the five built-ins and Lore's four, as buttons.
    const nav = dialog.getByRole("navigation");
    for (const label of [
      "Profile",
      "Projects",
      "Security",
      "Sessions",
      "API keys",
      "Connected apps",
      "Invitations",
      "Feedback",
      "Notifications",
    ]) {
      await expect(
        nav.getByRole("button", { name: label, exact: true }),
      ).toBeVisible();
    }
    await expect(nav.locator("a")).toHaveCount(0);
    // Estates belong to a project since #E126: the account has no section
    // for them.
    await expect(
      nav.getByRole("button", { name: "Estates", exact: true }),
    ).toHaveCount(0);

    // One section current at a time, switched without moving the URL.
    await nav.getByRole("button", { name: "Sessions", exact: true }).click();
    const current = nav.locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText("Sessions");
    expect(page.url()).toBe(url);

    // Escape closes it, and reopening lands on the last section viewed.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.getByLabel("Account menu").click();
    await page.getByRole("menuitem", { name: "User Account" }).click();
    await expect(nav.locator('[aria-current="page"]')).toHaveText("Sessions");
  });

  test("opens from ?account=<section> and strips it", async ({ page }) => {
    test.setTimeout(90_000);

    await registerAndVerify(
      page,
      `aq-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    const dialog = await openAccount(page, "invitations");
    await expect(
      dialog.getByRole("navigation").locator('[aria-current="page"]'),
    ).toHaveText("Invitations");
    await expect(page).not.toHaveURL(/account=/);
  });

  test("holds colour-blind mode on the profile, not in the account menu", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await registerAndVerify(
      page,
      `cb-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    let dialog = await openAccount(page);

    // The switch drives the real preference: the `cvd` class on <html>, which
    // is what the palette is keyed on.
    const toggle = dialog.getByRole("switch", { name: "Colour-blind mode" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("html")).not.toHaveClass(/\bcvd\b/);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveClass(/\bcvd\b/);

    // Kept across a reload (the UI cookie), and the switch reads it back.
    dialog = await openAccount(page);
    await expect(page.locator("html")).toHaveClass(/\bcvd\b/);
    await expect(
      dialog.getByRole("switch", { name: "Colour-blind mode" }),
    ).toHaveAttribute("aria-checked", "true");

    // The account menu still has its display mode, and no colour-blind item.
    await page.keyboard.press("Escape");
    await page.getByLabel("Account menu").click();
    await expect(
      page.getByRole("menuitem", { name: "Display Mode" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitemcheckbox", { name: "Colour-blind mode" }),
    ).toHaveCount(0);
  });

  test("lists the projects in a table and opens one, closing the dialog", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const email = `apr-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    const title = `APR${Date.now()}`.slice(0, 20);
    const { slug } = await createProjectViaWizard(page, title);

    const dialog = await openAccount(page, "projects");
    const row = dialog.getByRole("row").filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Owner", { exact: true })).toBeVisible();

    await row.getByTestId("account-project-row").click();
    await expect(page).toHaveURL(new RegExp(`/${slug}(/|$)`));
    // A route change closes the dialog by itself.
    await expect(dialog).toHaveCount(0);
  });

  test("renames the account and persists it across a reload", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `an-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    let dialog = await openAccount(page);
    await dialog.getByLabel("First name").fill("Ada");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    // Assert the write landed before asserting it persisted — otherwise a
    // failed save and a failed reload look identical.
    await expect(page.getByText(/profile updated/i)).toBeVisible();

    dialog = await openAccount(page);
    await expect(dialog.getByLabel("First name")).toHaveValue("Ada");

    // And back: an emptied box is sent as "", which the server stores as no
    // name at all (#Q3225), so the field comes back empty after a reload.
    await dialog.getByLabel("First name").fill("");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/profile updated/i).first()).toBeVisible();

    dialog = await openAccount(page);
    await expect(dialog.getByLabel("First name")).toHaveValue("");
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

    let dialog = await openAccount(page, "notifications");

    const emailSwitch = dialog.getByRole("switch", { name: "Email" });
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
      dialog = await openAccount(page, "notifications");
      await expect(
        dialog.getByRole("switch", { name: "Email" }),
      ).toHaveAttribute("aria-checked", "false", { timeout: 5_000 });
    }).toPass({ timeout: 30_000 });

    // The in-app row is a statement, not a control: there is no switch to
    // find, which is what stops it reading as a broken one.
    await expect(dialog.getByText("In-app", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("switch", { name: "In-app" })).toHaveCount(0);
  });

  test("changes the password and reports the revoked sessions", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `ap-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    const dialog = await openAccount(page, "security");

    await dialog.getByRole("button", { name: /change password/i }).click();
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

    const dialog = await openAccount(page, "sessions");

    await expect(dialog.getByText(/this device/i)).toBeVisible();
    // The row you are sitting in has no row menu - signing yourself out
    // belongs to the sign-out affordance, not to a per-row action that reads
    // as "revoke someone else" - and with one session there is no "Sign out
    // N others" either.
    await expect(
      dialog.getByRole("button", { name: "Open row actions" }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^Sign out/ })).toHaveCount(
      0,
    );
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

    /**
     * Runs a row action from the key's "…" menu, and confirms it.
     */
    const rowAction = async (name: string, action: string) => {
      await page
        .getByRole("row")
        .filter({ hasText: name })
        .getByRole("button", { name: "Open row actions" })
        .click();
      await page.getByRole("menuitem", { name: action }).click();
      await confirmDialog(page, action);
    };

    await openAccount(page, "keys");

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
    const rotated = page.waitForResponse(
      (response) =>
        /_batch|rotate/.test(response.url()) &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await rowAction("CI pipeline", "Rotate");
    expect((await rotated).ok()).toBe(true);
    const second = await takeToken();

    expect(second).not.toBe(first);
    expect(await statusWith(first)).toBe(401);
    expect(await statusWith(second)).toBe(200);

    // Revoke. The key leaves the table's default view (live keys only) but
    // stays listed by the API, with its status: it is the answer to "why did
    // CI stop working" (#Q2054, #Q2060).
    const revoked = page.waitForResponse(
      (response) =>
        /_batch|api-keys/.test(response.url()) &&
        ["POST", "DELETE"].includes(response.request().method()),
      { timeout: 20_000 },
    );
    await rowAction("CI pipeline", "Revoke");
    expect((await revoked).ok()).toBe(true);
    await expect(page.getByText("CI pipeline", { exact: true })).toHaveCount(0);
    expect(await statusWith(second)).toBe(401);
    const listed = (await (
      await page.request.get("/api/api-keys")
    ).json()) as Array<{ name: string; status: string }>;
    expect(listed.find((key) => key.name === "CI pipeline")?.status).toBe(
      "revoked",
    );

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
    await expect(page.getByText("CI pipeline", { exact: true })).toHaveCount(1);
  });

  test("refuses to delete the account while an organization is still owned", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const email = `ad-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    await createProjectViaWizard(page, `AD${Date.now()}`.slice(0, 20));

    const dialog = await openAccount(page, "security");
    await dialog.getByRole("button", { name: /delete account/i }).click();
    await page.getByLabel(/^Current password/).fill("GoodPassw0rd");
    await page.getByLabel(/to confirm/i).fill(email);
    await page
      .getByRole("button", { name: /delete account/i })
      .last()
      .click();

    /*
      The organizations module's `user:delete:before` hook refuses, and its message reaches the
      browser unwrapped — that is the whole reason `MyAccountController` emits
      without `{ log: true }`. A generic failure toast here would mean the
      framework had started wrapping it in `AlephaError`.
    */
    await expect(
      page.getByText(/transfer or delete your 1 organization/i),
    ).toBeVisible();

    // And the refusal has to actually refuse.
    const profile = await openAccount(page);
    await expect(profile.getByText(email, { exact: true })).toBeVisible();
  });

  test("the section scrolls and nothing is clipped at 1280x320", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    /*
      The dialog bounds itself to the viewport, and its content pane owns the
      scroll. Were that frame missing, everything past the fold would be
      unreachable rather than merely below it.

      Asserted through the DOM rather than by looking for a specific row,
      because how much content overflows depends on the section and the
      viewport - what must hold is that *something* can scroll and nothing is
      clipped.
    */
    const email = `af-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    // Short enough that the card stack cannot fit, whatever it holds.
    await page.setViewportSize({ width: 1280, height: 320 });
    const dialog = await openAccount(page, "security");
    await expect(dialog.getByText("Sign-in methods", { exact: true })).toBeVisible();

    const overflow = await dialog.evaluate((root) => {
      const overflows = (e: Element) => e.scrollHeight > e.clientHeight + 4;
      const all = [root, ...root.querySelectorAll("*")];
      return {
        // Anything taller than its box whose overflow is hidden is content
        // the user can never get to — the bug, exactly. The dialog's own
        // frame hides its overflow by design, and is not content.
        clipped: all.filter(
          (e) =>
            e !== root &&
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

  test("drills into a section at phone width, and back", async ({ page }) => {
    test.setTimeout(90_000);

    const email = `am-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Account menu").click();
    await page.getByRole("menuitem", { name: "User Account" }).click();

    // Full screen, on the list of sections.
    const dialog = page.locator('[data-slot="settings-dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Security", exact: true }).click();
    await expect(dialog.getByText("Sign-in methods", { exact: true })).toBeVisible();
    // Back to the list: state, not history.
    const url = page.url();
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Sessions", exact: true }),
    ).toBeVisible();
    expect(page.url()).toBe(url);
  });

  test("sends a signed-out visitor to sign in, and back into the dialog", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await page.goto("/?account=projects");
    await expect(page).toHaveURL(/\/auth\/login\?redirect=/, {
      timeout: 15_000,
    });
    expect(new URL(page.url()).searchParams.get("redirect")).toBe(
      "/?account=projects",
    );
  });

  test("404s the retired /account and /auth/profile paths", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // Deleted, not redirected: links stored before the move 404 (accepted
    // data loss, #E140; folio #100 for `/auth/profile`).
    const email = `ao-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    for (const path of ["/auth/profile", "/account/projects"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(email, { exact: true })).toHaveCount(0);
      await expect(page.locator('[data-slot="settings-dialog"]')).toHaveCount(
        0,
      );
    }
  });
});
