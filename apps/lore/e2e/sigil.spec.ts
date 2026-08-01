import { expect, type Page, test } from "@playwright/test";
import { createCampaignViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * Sigils, end to end: enrol an environment, report as it, triage what arrives,
 * rotate the credential, delete the environment.
 *
 * The surface under test is the one Task 4–7 rebuilt: a sigil is **one
 * application in one environment**, credentialed by an `sg_` bearer token that
 * is shown exactly once and stored hashed. Ingest is a root `$route`
 * (`POST /sigils/ingest`), authenticated by that token and by nothing else.
 *
 * Two mechanical traps, both of which have cost this project time before:
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
  test("enrol an environment, report as it, rotate it, delete it", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const t = Date.now();
    const email = `sigil${t}@example.com`;
    const campaignTitle = `Sig${t}`.slice(0, 20);
    const blightMessage = `SigilE2E_${t} is not a function`;

    await registerAndVerify(page, email, "SigilTest123!");
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    const ingest = `${baseURL}/sigils/ingest`;
    const config = `${baseURL}/sigils/config`;

    await test.step("the owner turns Sigils on from settings", async () => {
      await page.goto(`/c/${campaignId}/settings/sigils`);
      await page.waitForLoadState("networkidle");

      // The settings page rendering at all is worth asserting: removing this
      // route without editing the nav array crashed every settings page once.
      await expect(
        page.getByRole("switch", { name: "Enable", exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      await page.getByRole("switch", { name: "Enable", exact: true }).click();

      // The capability switches only exist once the master toggle is on.
      for (const capability of ["Petitions", "Blights", "Beacon", "Vitals"]) {
        const toggle = page.getByRole("switch", {
          name: capability,
          exact: true,
        });
        await expect(toggle).toBeVisible({ timeout: 15_000 });
        await toggle.click();
        await expect(toggle).toBeChecked({ timeout: 15_000 });
      }

      await expect(
        page.getByText(/No environment enrolled yet/i),
      ).toBeVisible();
    });

    let token = "";
    await test.step("enrolling app + environment mints a token, once", async () => {
      await page
        .getByRole("textbox", { name: "Application", exact: true })
        .fill("lore");
      await page
        .getByRole("textbox", { name: "Environment", exact: true })
        .fill("production");
      await page.getByRole("button", { name: "Enrol", exact: true }).click();

      token = await takeMintedToken(page);

      // The row names the credential by its prefix, and says the environment
      // has not reported — the two facts the list exists to carry.
      await expect(page.getByText("lore / production")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(`${token.slice(0, 11)}…`)).toBeVisible();
      await expect(page.getByText(/never reported/i)).toBeVisible();
    });

    await test.step("the same app + environment cannot be enrolled twice", async () => {
      await page
        .getByRole("textbox", { name: "Application", exact: true })
        .fill("lore");
      await page
        .getByRole("textbox", { name: "Environment", exact: true })
        .fill("production");
      await page.getByRole("button", { name: "Enrol", exact: true }).click();

      // A 409 surfaces as an error toast, and no second row appears — a second
      // sigil would split that environment's history across two credentials.
      await expect(page.getByText(/already exists/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("lore / production")).toHaveCount(1);
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
        petitionUrl?: string;
      };
      // Every capability was switched on above, so the answer is the campaign's
      // own toggles intersected with the sigil's kinds — all of them.
      expect(body.enabled).toEqual({ views: true, errors: true, vitals: true });
      expect(body.petitionUrl).toContain(`/c/${campaignId}/request`);

      const bogus = await request.get(config, {
        headers: { authorization: "Bearer sg_not_a_real_token" },
      });
      expect(bogus.status()).toBe(401);
    });

    await test.step("the settings row now says the environment reported", async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(/last reported/i)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("the error lands in the blights inbox", async () => {
      await page.goto(`/c/${campaignId}/blights`);
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
      await page.goto(`/c/${campaignId}/insights`);
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

    await test.step("the error budget names the environment that is still failing", async () => {
      // `sigil_error_groups` was written on every accepted error and read by
      // nothing outside `test/`. This is the surface that reads it — split per
      // environment, unlike the inbox, which folds every sigil into one row per
      // campaign on purpose.
      await page.getByRole("radio", { name: "Errors" }).click();

      await expect(page.getByText("Still happening")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(blightMessage)).toBeVisible();
      // The whole point of the table: which environment, by name.
      await expect(page.getByText("lore / production").first()).toBeVisible();
      // 3 + 4, counted per environment. Same total as the inbox here because
      // there is one sigil; the split is what the table exists to keep.
      await expect(page.getByText("7", { exact: true }).first()).toBeVisible();
    });

    let rotated = "";
    await test.step("rotating revokes the old token and keeps the history", async () => {
      await page.goto(`/c/${campaignId}/settings/sigils`);
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
      await page.goto(`/c/${campaignId}/blights`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(blightMessage)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("deleting the sigil retires its token", async () => {
      await page.goto(`/c/${campaignId}/settings/sigils`);
      await page.waitForLoadState("networkidle");

      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await confirmDialog(page, "Delete");

      await expect(page.getByText(/No environment enrolled yet/i)).toBeVisible({
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
      await page.goto(`/c/${campaignId}/blights`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(blightMessage)).toBeVisible({
        timeout: 15_000,
      });
    });
  });
});
