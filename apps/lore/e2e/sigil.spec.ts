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

/**
 * Poll `GET /api/getProjectById/:id` until `features[key]` matches `value`.
 *
 * `useProjectFeatureToggle` sets its `checked` prop optimistically the
 * instant a click fires (`enabled = pending ?? persisted[key] ?? false`) and
 * only clears `pending` once the write resolves — `await
 * expect(toggle).toBeChecked()` is satisfied by that optimistic value and
 * proves nothing about what the server actually has. A step that navigates
 * away (or an assertion downstream that depends on the server's copy — the
 * config gate, a route loader, the sidebar) can then race the write. Every
 * `$action` call is multiplexed through `POST /api/_batch`, so waiting on a
 * specific request is fragile; reading the value straight back from the
 * plain `GET` action route is not.
 */
const waitForProjectFeature = async (
  page: Page,
  projectId: number,
  key: string,
  value: boolean,
): Promise<void> => {
  await expect
    .poll(
      async () =>
        page.evaluate(
          async ({ projectId, key }) => {
            const r = await fetch(`/api/getProjectById/${projectId}`, {
              credentials: "include",
            });
            if (!r.ok) return undefined;
            const body = (await r.json()) as {
              features?: Record<string, boolean>;
            };
            return body.features?.[key];
          },
          { projectId, key },
        ),
      { timeout: 15_000 },
    )
    .toBe(value);
};

/**
 * Poll `GET /api/projects/:projectId/sigils` until the sigil named `name`
 * carries (`present: true`) or has dropped (`present: false`) `kind`.
 *
 * Same shape as {@link waitForProjectFeature}, one level down: reads the
 * capability straight back from the list endpoint rather than trusting the
 * switch on `AppSettings.tsx`'s Capabilities card, which renders from
 * `currentSigilAtom` — the SPA's belief, not a read of the server's row.
 */
const waitForSigilKind = async (
  page: Page,
  projectId: number,
  name: string,
  kind: string,
  present: boolean,
): Promise<void> => {
  await expect
    .poll(
      async () =>
        page.evaluate(
          async ({ projectId, name, kind }) => {
            const r = await fetch(`/api/projects/${projectId}/sigils`, {
              credentials: "include",
            });
            if (!r.ok) return undefined;
            const body = (await r.json()) as {
              items: { name: string; kinds: string[] }[];
            };
            const sigil = body.items.find((it) => it.name === name);
            return sigil ? sigil.kinds.includes(kind) : undefined;
          },
          { projectId, name, kind },
        ),
      { timeout: 15_000 },
    )
    .toBe(present);
};

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
    // Distinct from the project title so `getByText` cannot match the header,
    // and constrained to `APP_NAME_PATTERN` — it's the app's URL segment now
    // (`/p/:projectId/apps/:appName`), so a capital or a space would be
    // refused rather than just cosmetic.
    const appName = `app-${t}`;
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

      // The switch's own `checked` state is optimistic (see
      // `waitForProjectFeature`) — wait on the server directly, since
      // everything from here on (enrolling, ingest's config gate, the app
      // and blights route loaders, the sidebar's Apps group) depends on
      // `features.sigils` actually being on, not just the switch looking on.
      await waitForProjectFeature(page, projectId, "sigils", true);

      // Capabilities moved off this page (Task 8): what an app may report is
      // per-app now, set on that app's own Settings tab, not a project-wide
      // Capabilities card here. A newly enrolled sigil carries all four
      // kinds by default, so nothing else is needed before ingest.
      await expect(page.getByText(/No app enrolled yet/i)).toBeVisible();
    });

    let token = "";
    await test.step("enrolling an app mints a token, once", async () => {
      // The card-button and the dialog's own submit share the accessible
      // name "Enroll" — only one is on screen before the dialog opens.
      await page.getByRole("button", { name: "Enroll", exact: true }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await dialog
        .getByRole("textbox", { name: "App name", exact: true })
        .fill(appName);
      await dialog.getByRole("button", { name: "Enroll", exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
      await releasePointerEvents(page);

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
      await page.getByRole("button", { name: "Enroll", exact: true }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await dialog
        .getByRole("textbox", { name: "App name", exact: true })
        .fill(appName);
      await dialog.getByRole("button", { name: "Enroll", exact: true }).click();

      // A 409 surfaces as an error toast, and no second row appears — a second
      // sigil would split that app's history across two credentials. The toast
      // names the offending sigil, so the row count is scoped to the list.
      await expect(page.getByText(/already exists/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(sigilRows(page, appName)).toHaveCount(1);

      // Only a successful submit closes the dialog — dismiss it explicitly
      // so the next click doesn't land on a `pointer-events: none` body.
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
      await releasePointerEvents(page);
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

    await test.step("the owner turns Feedback on from its own settings page", async () => {
      // Off by default for a wizard-created project — `ProjectCreate.tsx`'s
      // `DEFAULT_FEATURES` sends `feedback: false` even though the
      // entity-level `defaultProjectFeatures` defaults it on; the wizard
      // deliberately starts a project with no feedback inbox. It moved off
      // the Sigils page (Task 8) onto its own page (Task 7), which
      // otherwise has no e2e coverage at all — this step earns its keep
      // twice.
      await page.goto(`/p/${projectId}/settings/feedback`);
      await page.waitForLoadState("networkidle");

      const toggle = page.getByRole("switch", { name: "Enable", exact: true });
      await expect(toggle).toBeVisible({ timeout: 15_000 });
      await toggle.click();
      // Not `toBeChecked()` — that's satisfied by `useProjectFeatureToggle`'s
      // optimistic `pending` value the instant the click fires, which proves
      // nothing about whether `updateProjectById` has actually landed. This
      // is exactly the write the very next step's assertion depends on.
      await waitForProjectFeature(page, projectId, "feedback", true);

      // Back to the Sigils settings page — "the sink tells the app what it
      // wants" step below only makes API calls (no navigation of its own),
      // and the step after that reloads *this* page expecting to still be
      // looking at the sigil row.
      await page.goto(`/p/${projectId}/settings/sigils`);
      await page.waitForLoadState("networkidle");
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
      // A newly enrolled sigil carries all four kinds by default and the
      // project's `sigils` master switch is on, so the answer is everything
      // — `feedback` is the one gate that also needs the project's own
      // `features.feedback`, off by default for a wizard-created project and
      // turned on above through its own settings page.
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

    await test.step("the sidebar's Apps section opens the app's own page", async () => {
      // The section is the only way in that does not require knowing a UUID.
      // It's a collapsible group, but with one app it starts *open* — the
      // shell only leaves it collapsed past five — so there is nothing to
      // click before the app's own link is reachable.
      await page.goto(`/p/${projectId}`);
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByRole("button", { name: "Apps", exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await page.getByRole("link", { name: appName, exact: true }).click();

      await expect(page).toHaveURL(
        new RegExp(`/p/${projectId}/apps/${appName}`),
        { timeout: 15_000 },
      );
      await expect(
        page.getByRole("heading", { name: appName, exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      // Every tab exists. Scoped to the tab bar: "Settings" is also a
      // project-level sidebar entry, so a page-wide match proves nothing.
      const tabs = page.getByTestId("app-tabs");
      for (const label of [
        "Dashboard",
        "Analytics",
        "Performance",
        "Settings",
      ]) {
        await expect(
          tabs.getByRole("link", { name: label, exact: true }),
        ).toBeVisible();
      }
    });

    await test.step("the Analytics tab renders what was just reported", async () => {
      await page
        .getByTestId("app-tabs")
        .getByRole("link", { name: "Analytics", exact: true })
        .click();

      // Two views of /checkout from one visitor. The numbers are asserted, not
      // just the headings — a page that renders zeros proves only that it does
      // not throw.
      await expect(page.getByText("Top pages")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Unique visitors")).toBeVisible();
      await expect(page.getByText("/checkout").first()).toBeVisible();
      // The only page reported, so its two views are 100% of the total.
      await expect(page.getByText(/2\s*·\s*100%/)).toBeVisible();
      // This deployment runs the relational backend, where `estimated` is
      // always false — the qualifier must not appear. Pins "no false
      // qualifier" as deliberate rather than an untested absence.
      await expect(page.getByText("Estimated")).toHaveCount(0);
    });

    await test.step("the Performance tab reports the vitals p75", async () => {
      // The 2100 ms LCP sample lands in the ≤2500 bucket, and p75 reports that
      // bucket's upper boundary. The thousands separator is whatever the
      // browser's locale uses.
      await page
        .getByTestId("app-tabs")
        .getByRole("link", { name: "Performance", exact: true })
        .click();

      await expect(page.getByText("Web Vitals")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/2[,.\s]?500\s*ms/)).toBeVisible();
    });

    await test.step("turning Beacon off hides the analytics tabs, back on restores them", async () => {
      // Capabilities live on the app's own Settings tab now, not a
      // project-wide card — the switch here governs this app alone.
      await page
        .getByTestId("app-tabs")
        .getByRole("link", { name: "Settings", exact: true })
        .click();

      const beacon = page.getByRole("switch", { name: "Beacon", exact: true });
      await expect(beacon).toBeVisible({ timeout: 15_000 });
      // A freshly enrolled sigil carries all four kinds by default — this
      // read reflects the page's loader, not a click, so there's no write to
      // race here.
      await expect(beacon).toBeChecked();

      await beacon.click();
      // Not `not.toBeChecked()` — poll the sigil's own `kinds` on the server
      // instead of the switch, which renders from `currentSigilAtom` (the
      // SPA's copy). Same optimistic-switch shape as
      // `waitForProjectFeature`, one level down.
      await waitForSigilKind(page, projectId, appName, "beacon", false);

      // The toggle drives a `router.reload()` itself (see
      // AppSettingsCapabilities.tsx), so the tab bar reflects the app's own
      // kinds without a manual page reload.
      const tabs = page.getByTestId("app-tabs");
      for (const label of ["Analytics", "Performance"]) {
        await expect(
          tabs.getByRole("link", { name: label, exact: true }),
        ).toHaveCount(0, { timeout: 15_000 });
      }

      await beacon.click();
      await waitForSigilKind(page, projectId, appName, "beacon", true);

      for (const label of ["Analytics", "Performance"]) {
        await expect(
          tabs.getByRole("link", { name: label, exact: true }),
        ).toBeVisible({ timeout: 15_000 });
      }

      // Regression guard for a real bug (Task 6): `currentSigilInsightsAtom`
      // is filled by the `projectApp` loader alone, and a sibling-tab
      // navigation (Settings → Analytics) reuses that loader's layer instead
      // of re-running it, so the atom stayed stale after Beacon flipped back
      // on and Analytics rendered blank. `router.reload()` on the toggle is
      // the fix — assert the tab renders content, not just that the link
      // exists.
      await tabs.getByRole("link", { name: "Analytics", exact: true }).click();
      await expect(page.getByText("Top pages")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("/checkout").first()).toBeVisible();
    });

    let rotated = "";
    await test.step("rotating revokes the old token and keeps the history", async () => {
      // Rotate and delete live on the app's own Settings tab — they are per-app
      // actions, and the project settings page enrols rather than administers.
      await page
        .getByTestId("app-tabs")
        .getByRole("link", { name: "Settings", exact: true })
        .click();

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
      // Back to the app's Settings tab — the same page rotate was driven
      // from. Still one app, so the group is still open by default — no
      // click needed to reach the link.
      await page.goto(`/p/${projectId}`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("link", { name: appName, exact: true }).click();
      await page
        .getByTestId("app-tabs")
        .getByRole("link", { name: "Settings", exact: true })
        .click();

      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await confirmDialog(page, "Delete");

      // Its own page no longer has a subject, so the delete lands the operator
      // back on the enrolment page — which now says there is nothing enrolled.
      await expect(page).toHaveURL(
        new RegExp(`/p/${projectId}/settings/sigils`),
        { timeout: 15_000 },
      );
      await expect(page.getByText(/No app enrolled yet/i)).toBeVisible({
        timeout: 15_000,
      });

      // The Apps group is only built when the project has apps or the read
      // failed (ProjectView.tsx) — with zero apps left, the whole section
      // vanishes rather than rendering an empty shell.
      await expect(
        page.getByRole("button", { name: "Apps", exact: true }),
      ).toHaveCount(0);
      // Blights, by contrast, stays. The blight outlives the credential that
      // filed it — `blights.sigilId` is `ON DELETE SET NULL`, because a triage
      // decision is not the sigil's — and it is still open, so the inbox must
      // still be reachable. Deriving the entry from the enrolled apps alone
      // would have hidden an inbox that still holds crashes. It renders as a
      // link (a leaf item), not a button — only the collapsible Apps group
      // above is a button.
      const blightsEntry = page.getByRole("link", {
        name: "Blights",
        exact: true,
      });
      await expect(blightsEntry).toBeVisible({ timeout: 15_000 });

      const revoked = await request.post(ingest, {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${rotated}`,
        },
        data: { views: [{ path: "/" }] },
      });
      expect(revoked.status()).toBe(401);

      // Reachable, not merely rendered: the surviving blight is one click from
      // the sidebar, no deep link needed.
      await blightsEntry.click();
      await expect(page).toHaveURL(new RegExp(`/p/${projectId}/blights`), {
        timeout: 15_000,
      });
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(blightMessage)).toBeVisible({
        timeout: 15_000,
      });
    });
  });
});
