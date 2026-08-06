import { expect, type Page, test } from "@playwright/test";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * Sigils, end to end: enrol an app, report as it, triage what arrives, rotate
 * the credential, delete the app.
 *
 * The surface under test: a sigil is **one named app**, unique within its
 * project, credentialed by an `sg_` bearer token that is shown exactly once and
 * stored hashed. Ingest is a root `$route` (`POST /sigils/ingest`),
 * authenticated by that token and by nothing else.
 *
 * Two mechanical traps, both of which have cost this codebase time before:
 *
 * 1. **Never drive ingest through the page.** Alepha patches the browser's
 *    `fetch` to attach the session bearer, which silently replaces the sigil
 *    token on the way out — the request then arrives as the logged-in user and
 *    is refused, or worse, is accepted for the wrong reason. Playwright's
 *    `request` fixture is a separate context with its own (empty) cookie jar
 *    and no page JavaScript, which is exactly what a reporting app looks like.
 * 2. **Never wait on a named API response.** Every `$action` call the SPA makes
 *    is multiplexed through `POST /api/_batch`, so `waitForResponse` on a
 *    per-action URL never fires. Assert on rendered state instead.
 */

/**
 * Base UI leaves `pointer-events: none` on `<body>` after a dialog closes, and
 * the next click then lands on nothing until React happens to re-render. The
 * dialog is genuinely gone by then — this only clears the residue it left.
 */
const releasePointerEvents = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.body.style.pointerEvents = "";
  });
};

/**
 * Answer the confirmation `useDialog()` opened, by the label on its action
 * button. `AlertDialogAction` renders the `confirmLabel` verbatim.
 */
const confirmDialog = async (page: Page, label: string): Promise<void> => {
  const dialog = page.locator('[role="alertdialog"], [role="dialog"]').last();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await releasePointerEvents(page);
};

/**
 * Read the one-time token panel and dismiss it.
 *
 * The panel is the only place the cleartext token ever exists — the column
 * holds a hash — so this both captures it and asserts that dismissing really
 * takes it off the page.
 */
const takeMintedToken = async (page: Page): Promise<string> => {
  const panel = page.getByRole("alert").filter({ hasText: /Copy this token/i });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  const token = (await panel.locator("code").first().innerText()).trim();
  expect(token).toMatch(/^sg_/);

  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await expect(panel).toBeHidden({ timeout: 10_000 });
  // The full token is gone; only the prefix survives, on the row.
  await expect(page.getByText(token, { exact: true })).toHaveCount(0);

  return token;
};

/**
 * The rows of the sigil list carrying `name`.
 *
 * Scoped to `data-testid="sigil-row"` rather than `page.getByText(name)`,
 * because the conflict message embeds the sigil's name — "A sigil already
 * exists named X" — so a page-wide count of X counts the error toast as well as
 * the row. The question this list answers is *how many rows*, and a page-wide
 * count answered it correctly only while the message happened not to contain the
 * value being counted.
 */
const sigilRows = (page: Page, name: string) =>
  page.getByTestId("sigil-row").filter({ hasText: name });

/** One aggregated client error, as the cable would forward it. */
const errorBatch = (message: string, count: number) => ({
  errors: [
    {
      name: "TypeError",
      message,
      stack: `TypeError: ${message}\n    at checkout (/app/checkout.js:42:10)`,
      sourceUrl: "https://partner.example.com/checkout",
      origin: "client" as const,
      count,
    },
  ],
});

test.describe("Sigils", () => {
  test("enrol an app, report as it, rotate it, delete it", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const t = Date.now();
    const email = `sigil${t}@example.com`;
    const projectTitle = `Sig${t}`.slice(0, 20);
    // Distinct from the project title so `getByText` cannot match the header.
    const appName = `App${t}`;
    const blightMessage = `SigilE2E_${t} is not a function`;

    await registerAndVerify(page, email, "SigilTest123!");
    const projectId = await createProjectViaWizard(page, projectTitle);

    const ingest = `${baseURL}/sigils/ingest`;
    const config = `${baseURL}/sigils/config`;

    await test.step("the owner turns Sigils on from settings", async () => {
      await page.goto(`/p/${projectId}/settings/sigils`);
      await page.waitForLoadState("networkidle");

      // The settings page rendering at all is worth asserting: removing this
      // route without editing the nav array crashed every settings page once.
      await expect(
        page.getByRole("switch", { name: "Enable", exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      await page.getByRole("switch", { name: "Enable", exact: true }).click();

      // The capability switches only exist once the master toggle is on.
      for (const capability of ["Feedback", "Blights", "Beacon", "Vitals"]) {
        const toggle = page.getByRole("switch", {
          name: capability,
          exact: true,
        });
        await expect(toggle).toBeVisible({ timeout: 15_000 });
        await toggle.click();
        await expect(toggle).toBeChecked({ timeout: 15_000 });
      }

      await expect(page.getByText(/No app enrolled yet/i)).toBeVisible();
    });

    let token = "";
    await test.step("enrolling an app mints a token, once", async () => {
      await page
        .getByRole("textbox", { name: "App name", exact: true })
        .fill(appName);
      await page.getByRole("button", { name: "Enrol", exact: true }).click();

      token = await takeMintedToken(page);

      // Exactly one row, and it names the credential by its prefix and says the
      // app has not reported — the two facts the list exists to carry. Asserted
      // *on the row* rather than on the page, so "the list shows this" cannot be
      // satisfied by a toast that happens to say the same thing.
      const row = sigilRows(page, appName);
      await expect(row).toHaveCount(1, { timeout: 15_000 });
      await expect(row.getByText(`${token.slice(0, 11)}…`)).toBeVisible();
      await expect(row.getByText(/never reported/i)).toBeVisible();
    });

    await test.step("the same name cannot be enrolled twice", async () => {
      await page
        .getByRole("textbox", { name: "App name", exact: true })
        .fill(appName);
      await page.getByRole("button", { name: "Enrol", exact: true }).click();

      // A 409 surfaces as an error toast, and no second row appears — a second
      // sigil would split that app's history across two credentials. The toast
      // names the offending sigil, so the row count is scoped to the list.
      await expect(page.getByText(/already exists/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(sigilRows(page, appName)).toHaveCount(1);
    });

    await test.step("the token, and only the token, opens ingest", async () => {
      const anonymous = await request.post(ingest, {
        headers: { "content-type": "application/json" },
        data: { views: [{ path: "/" }] },
      });
      expect(anonymous.status()).toBe(401);

      const bogus = await request.post(ingest, {
        headers: {
          "content-type": "application/json",
          authorization: "Bearer sg_not_a_real_token",
        },
        data: { views: [{ path: "/" }] },
      });
      expect(bogus.status()).toBe(401);
    });

    await test.step("a batch of views, errors and vitals is accepted", async () => {
      const res = await request.post(ingest, {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        data: {
          views: [{ path: "/checkout" }, { path: "/checkout" }],
          vitals: [{ path: "/checkout", metric: "lcp", value: 2100 }],
          country: "FR",
          visitor: `v-${t}`,
          ...errorBatch(blightMessage, 3),
        },
      });
      expect(res.status()).toBe(204);
    });

    await test.step("the sink tells the app what it wants", async () => {
      const res = await request.get(config, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(200);

      const body = (await res.json()) as {
        enabled: Record<string, boolean>;
        feedbackUrl?: string;
      };
      // Every capability was switched on above, so the answer is the project's
      // own toggles intersected with the sigil's kinds — all of them.
      expect(body.enabled).toEqual({ views: true, errors: true, vitals: true });
      expect(body.feedbackUrl).toContain(`/p/${projectId}/request`);

      const bogus = await request.get(config, {
        headers: { authorization: "Bearer sg_not_a_real_token" },
      });
      expect(bogus.status()).toBe(401);
    });

    await test.step("the settings row now says the app reported", async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(/last reported/i)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("the error lands in the blights inbox", async () => {
      await page.goto(`/p/${projectId}/blights`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByText(blightMessage)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("3", { exact: true }).first()).toBeVisible();
    });

    await test.step("a second batch merges into the same row", async () => {
      const res = await request.post(ingest, {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        data: errorBatch(blightMessage, 4),
      });
      expect(res.status()).toBe(204);

      await page.reload();
      await page.waitForLoadState("networkidle");

      // 3 + 4 on one row: the real magnitude of a crash loop, not two rows of
      // one. The fingerprint is derived from name + stack, which both batches
      // share.
      await expect(page.getByText(blightMessage)).toHaveCount(1);
      await expect(page.getByText("7", { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("the insights page renders what was just reported", async () => {
      // 491 restored lines across three components plus a nav entry, and
      // nothing in the repo rendered any of them. A nav entry pointing at a
      // page that throws is exactly what took six specs down in `5366c6e4d`.
      await page.goto(`/p/${projectId}/insights`);
      await page.waitForLoadState("networkidle");

      // Analytics: two views of /checkout from one visitor. The numbers are
      // asserted, not just the headings — a page that renders zeros proves
      // only that it does not throw.
      await expect(page.getByText("Unique visitors")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Top pages")).toBeVisible();
      await expect(page.getByText("/checkout").first()).toBeVisible();
      // The only page reported, so its two views are 100% of the total.
      await expect(page.getByText(/2\s*·\s*100%/)).toBeVisible();

      // Performance: the 2100 ms LCP sample lands in the ≤2500 bucket, and p75
      // reports that bucket's upper boundary. The thousands separator is
      // whatever the browser's locale uses.
      await page.getByRole("radio", { name: "Performance" }).click();
      await expect(page.getByText("Web Vitals")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/2[,.\s]?500\s*ms/)).toBeVisible();
    });

    await test.step("the error budget names the app that is still failing", async () => {
      // `sigil_error_groups` was written on every accepted error and read by
      // nothing outside `test/`. This is the surface that reads it — split per
      // sigil, unlike the inbox, which folds every sigil into one row per
      // project on purpose.
      await page.getByRole("radio", { name: "Errors" }).click();

      await expect(page.getByText("Still happening")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(blightMessage)).toBeVisible();
      // The whole point of the table: which app, by name.
      await expect(page.getByText(appName).first()).toBeVisible();
      // 3 + 4, counted per app. Same total as the inbox here because there is
      // one sigil; the split is what the table exists to keep.
      await expect(page.getByText("7", { exact: true }).first()).toBeVisible();
    });

    let rotated = "";
    await test.step("rotating revokes the old token and keeps the history", async () => {
      await page.goto(`/p/${projectId}/settings/sigils`);
      await page.waitForLoadState("networkidle");

      await page.getByRole("button", { name: "Rotate", exact: true }).click();
      await confirmDialog(page, "Rotate");

      rotated = await takeMintedToken(page);
      expect(rotated).not.toBe(token);

      // The old credential stops resolving the instant the hash changes —
      // `verify` looks a sigil up *by* its hash.
      const stale = await request.post(ingest, {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        data: { views: [{ path: "/" }] },
      });
      expect(stale.status()).toBe(401);

      const fresh = await request.post(ingest, {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${rotated}`,
        },
        data: { views: [{ path: "/" }] },
      });
      expect(fresh.status()).toBe(204);

      // Rotation is revocation *without* the amnesia — this is the whole
      // reason it exists beside delete.
      await page.goto(`/p/${projectId}/blights`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(blightMessage)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("deleting the sigil retires its token", async () => {
      await page.goto(`/p/${projectId}/settings/sigils`);
      await page.waitForLoadState("networkidle");

      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await confirmDialog(page, "Delete");

      await expect(page.getByText(/No app enrolled yet/i)).toBeVisible({
        timeout: 15_000,
      });

      const revoked = await request.post(ingest, {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${rotated}`,
        },
        data: { views: [{ path: "/" }] },
      });
      expect(revoked.status()).toBe(401);

      // The blight outlives the credential that filed it: `blights.sigilId` is
      // `ON DELETE SET NULL`, because a triage decision is not the sigil's.
      await page.goto(`/p/${projectId}/blights`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(blightMessage)).toBeVisible({
        timeout: 15_000,
      });
    });
  });
});
