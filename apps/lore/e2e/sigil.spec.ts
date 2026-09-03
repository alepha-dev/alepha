import { sigilKeyPrefix, sigilKeyProject } from "@alepha/lore/sigil";
import { expect, type Page, type Request, test } from "@playwright/test";

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

/**
 * One aggregated client error, as the cable would forward it.
 */
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
/**
 * Every insights request the page makes while `run` is in flight.
 *
 * ⚠️ Watching the URL alone is not enough: the React client batches actions
 * through `POST /api/_batch`, so an insights read reaches the wire as one line
 * inside somebody else's request body. Both shapes are checked.
 */
const insightsCalls = async (
  page: Page,
  run: () => Promise<void>,
): Promise<string[]> => {
  const calls: string[] = [];
  const listen = (request: Request) => {
    const url = request.url();
    if (url.includes("/insights")) {
      calls.push(url);
      return;
    }
    if (url.includes("/api/_batch")) {
      const body = request.postData() ?? "";
      if (body.includes("insights") || body.includes("Insights")) {
        calls.push(body.slice(0, 200));
      }
    }
  };

  page.on("request", listen);
  try {
    await run();
  } finally {
    page.off("request", listen);
  }
  return calls;
};

/**
 * Sets an app's `kinds` through the API.
 *
 * There is no control for this on the page any more. The four switches were
 * deleted with the Settings rebuild because they read as the app's
 * configuration and are not: `SIGIL_CONFIG` in the app's own deploy decides
 * what is SENT, and `kinds` decides only what this sink ACCEPTS. The gate
 * itself did not move — `SigilIngestService.gatesFor` still enforces it — so
 * the behaviour below is still worth guarding, and this is how it is reached.
 *
 * Through `page.evaluate` rather than the `request` fixture, so the browser's
 * own session cookie authenticates it, the way `waitForSigilKind` reads.
 */
const setSigilKinds = async (
  page: Page,
  projectId: number,
  name: string,
  kinds: string[],
): Promise<void> => {
  const ok = await page.evaluate(
    async ({ projectId, name, kinds }) => {
      const list = await fetch(`/api/projects/${projectId}/sigils`, {
        credentials: "include",
      });
      if (!list.ok) return false;
      const body = (await list.json()) as {
        items: { id: string; name: string }[];
      };
      const sigil = body.items.find((it) => it.name === name);
      if (!sigil) return false;
      const res = await fetch(`/api/projects/${projectId}/sigils/${sigil.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kinds }),
      });
      return res.ok;
    },
    { projectId, name, kinds },
  );
  expect(ok).toBe(true);
};

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
    // (`/:projectSlug/apps/:appName`), so a capital or a space would be
    // refused rather than just cosmetic.
    const appName = `app-${t}`;
    const blightMessage = `SigilE2E_${t} is not a function`;

    await registerAndVerify(page, email, "SigilTest123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const ingest = `${baseURL}/sigils/ingest`;

    await test.step("the owner turns Sigils on from settings", async () => {
      await page.goto(`/${projectSlug}/settings/sigils`);
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
      // The minted token names the project it reports into, which is what
      // spares the app a second variable saying so. Asserted here rather than
      // only in the unit specs because this is the one place the whole chain
      // runs: a real project, its real slug, and the token an operator copies.
      expect(sigilKeyProject(token)).toBeTruthy();

      const row = sigilRows(page, appName);
      await expect(row).toHaveCount(1, { timeout: 15_000 });
      await expect(row.getByText(`${sigilKeyPrefix(token)}…`)).toBeVisible();
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
          // One arrival carrying its three arrival facts, then a second view
          // from the same visit carrying none — the shape the browser really
          // sends, and the only shape that proves `entries` is not just
          // `count` under another name.
          views: [
            {
              path: "/checkout",
              entry: true,
              referrer: "news.ycombinator.com",
              campaign: "hn",
            },
            { path: "/checkout" },
          ],
          engagements: [{ path: "/checkout" }],
          vitals: [{ path: "/checkout", metric: "lcp", value: 2100 }],
          country: "FR",
          device: "mobile",
          // The two the proxy classifies off the same header `device` comes
          // from. Sent by hand here for the same reason `device` is: this
          // batch bypasses the proxy.
          browser: "safari",
          os: "ios",
          visitor: `v-${t}`,
          // Where the app answers, which its own server is the only party that
          // knows. Stamped by `SigilProxyController` in a real app; sent by
          // hand here for the same reason `visitor` and `country` are.
          host: "docs.alepha.dev",
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
      await page.goto(`/${projectSlug}/settings/feedback`);
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
      await page.goto(`/${projectSlug}/settings/sigils`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("an unknown token is refused at the ingest door", async () => {
      // There used to be a `GET /sigils/config` step here, checking what the
      // sink would tell an app to collect. An app reads that from its own
      // `SIGIL_CONFIG` now, so the endpoint is gone and ingest is the only
      // door — which makes it the one that has to refuse a stranger.
      const bogus = await request.post(ingest, {
        headers: { authorization: "Bearer sg_not_a_real_token" },
        data: { views: [{ path: "/home" }] },
      });
      expect(bogus.status()).toBe(401);
    });

    await test.step("the Errors tab shows the failure, scoped to this app", async () => {
      // The other side of #1749. The Blights inbox below answers "has anyone
      // triaged this"; this tab answers "is it still happening HERE", which
      // the inbox cannot, because it keys on `(project, fingerprint)`.
      await page.goto(`/${projectSlug}/apps/${appName}/errors`);
      await page.waitForLoadState("networkidle");

      const group = page.getByTestId("app-error-group");
      await expect(group).toHaveCount(1, { timeout: 15_000 });
      await expect(group).toContainText(blightMessage);
      // The occurrence count, which the card this replaced never showed: it
      // rendered `errorGroups.length` and nothing from inside a group.
      await expect(group).toContainText("3");

      // And the card is gone from the page it was asked to leave.
      await page.goto(`/${projectSlug}/apps/${appName}/analytics`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("insights-errors")).toHaveCount(0);
    });

    await test.step("the settings row now says the app reported", async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(/last reported/i)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("the error lands in the blights inbox", async () => {
      await page.goto(`/${projectSlug}/blights`);
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
      await page.goto(`/${projectSlug}`);
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByRole("button", { name: "Apps", exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await page.getByRole("link", { name: appName, exact: true }).click();

      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/apps/${appName}`),
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
        "Vitals",
        // #1749: the error budget left the Analytics page (feedback #2080,
        // "remove Blights Card on Analytics page, it's not the right place")
        // and became a tab rather than being deleted, because the per-app
        // reading is the one thing the project Blights inbox structurally
        // cannot give - it keys on `(project, fingerprint)` so a triage
        // decision does not fork, which merges every enrolled app into one row.
        "Errors",
        "Explore",
        "Artifacts",
        "Settings",
      ]) {
        await expect(
          tabs.getByRole("link", { name: label, exact: true }),
        ).toBeVisible();
      }
    });

    await test.step("the Apps crumb opens the inventory, which the sidebar does not", async () => {
      // The crumb used to render as dead text because there was no list route
      // at all. It is the ONLY door: a sidebar entry beside the disclosure
      // group would be a second one to the same information.
      await page
        .getByLabel("breadcrumb")
        .getByRole("link", { name: "Apps", exact: true })
        .click();

      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/apps$`), {
        timeout: 15_000,
      });
      const table = page.getByTestId("apps-table");
      await expect(table.getByRole("link", { name: appName })).toBeVisible({
        timeout: 15_000,
      });
      // The address it reported, resolved the same way the app header does.
      await expect(table.getByText("docs.alepha.dev")).toBeVisible();

      // #1751, feedback #2081. Two notes on this page, one assertion each.
      //
      // The heading is gone: the breadcrumb already says "Apps" two lines up,
      // and no other project list carries one.
      await expect(table.locator("h1")).toHaveCount(0);

      // And the Reports column holds its badges on ONE line. This app carries
      // all four kinds, and the cell used to be `flex-wrap`, so it stacked
      // them into a column and made the row four times the height of a
      // neighbour. Measured rather than asserted on a class: a row that fits
      // is the claim.
      const rowHeight = await table
        .locator("tbody tr")
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().height));
      expect(rowHeight).toBeLessThan(60);

      // Back to the app, which the rest of this flow addresses directly.
      await table.getByRole("link", { name: appName }).click();
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/apps/${appName}`),
        { timeout: 15_000 },
      );
    });

    await test.step("the Dashboard shows state, and asks the server for no analytics", async () => {
      // The property the page was rebuilt for. It used to render three
      // counters out of an insights payload, so opening the front page of an
      // app cost ten aggregate queries against Analytics Engine.
      const calls = await insightsCalls(page, async () => {
        await page.goto(`/${projectSlug}/apps/${appName}`);
        await page.waitForLoadState("networkidle");
        await expect(page.getByTestId("app-identity")).toBeVisible({
          timeout: 15_000,
        });
      });
      expect(calls).toEqual([]);

      // What the app SAYS it sends, beside what Lore ACCEPTS. This batch was
      // posted without a `config`, so the app has told us nothing and the page
      // has to say so rather than render it as off.
      const capabilities = page.getByTestId("app-capabilities");
      await expect(capabilities.getByText("Page views")).toBeVisible();
      // `exact`, because the copy below the table names the same thing in a
      // sentence — which is the copy the last assertion in this step is about.
      await expect(
        capabilities.getByText("Lore accepts", { exact: true }),
      ).toBeVisible();
      await expect(
        capabilities.getByText(/has not reported its configuration/),
      ).toBeVisible();

      // Read-only, and the copy points at the two places each column is
      // actually changed.
      await expect(capabilities.getByRole("switch")).toHaveCount(0);
      await expect(capabilities.getByText(/SIGIL_CONFIG/)).toBeVisible();
    });

    await test.step("the header names where the app answers, from what it reported", async () => {
      // Nobody typed this. It is the `host` of the batch three steps up,
      // stamped onto the sigil beside `lastSeenAt` — which is the whole point
      // of detecting it rather than asking for it.
      const link = page.getByRole("link", {
        name: "docs.alepha.dev",
        exact: true,
      });
      await expect(link).toBeVisible({ timeout: 15_000 });
      await expect(link).toHaveAttribute("href", "https://docs.alepha.dev");
      // It leaves Lore, so it must not hand `window.opener` to a page Lore
      // does not control.
      await expect(link).toHaveAttribute("rel", /noopener/);
    });

    await test.step("an operator can pin a different URL, and take it back off", async () => {
      await page
        .getByTestId("app-tabs")
        .getByRole("link", { name: "Settings", exact: true })
        .click();

      const field = page.getByRole("textbox", { name: "App URL", exact: true });
      await expect(field).toBeVisible({ timeout: 15_000 });
      // The detected host as the placeholder is what makes an empty field read
      // as "using what the app reports" instead of as "nobody filled this in".
      await expect(field).toHaveAttribute(
        "placeholder",
        "https://docs.alepha.dev",
      );

      await field.fill("https://alepha.dev/docs");
      await page.getByRole("button", { name: "Save", exact: true }).click();

      const pinned = page.getByRole("link", {
        name: "alepha.dev/docs",
        exact: true,
      });
      await expect(pinned).toBeVisible({ timeout: 15_000 });
      await expect(pinned).toHaveAttribute("href", "https://alepha.dev/docs");

      // And back: clearing the field returns the answer to the reported host,
      // which is the only reason an empty value has to mean something.
      await field.fill("");
      await page.getByRole("button", { name: "Save", exact: true }).click();

      await expect(
        page.getByRole("link", { name: "docs.alepha.dev", exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      // ⚠️ The render above does NOT prove this. `appUrl` falls back on any
      // falsy `url`, so a stored `""` and a stored null look identical on
      // screen — which is why folio #1121 records this as verified by hand
      // once and never pinned. Asked of the server instead.
      const stored = await page.evaluate(
        async ({ projectId, name }) => {
          const r = await fetch(`/api/projects/${projectId}/sigils`, {
            credentials: "include",
          });
          const body = (await r.json()) as {
            items: { name: string; url?: string | null }[];
          };
          return body.items.find((it) => it.name === name)?.url ?? null;
        },
        { projectId, name: appName },
      );
      expect(stored).toBeNull();
    });

    await test.step("the Analytics tab renders what was just reported", async () => {
      await page
        .getByTestId("app-tabs")
        .getByRole("link", { name: "Analytics", exact: true })
        .click();

      // Two views of /checkout from one visitor. The numbers are asserted, not
      // just the headings — a page that renders zeros proves only that it does
      // not throw.
      //
      // Every count is scoped to its own card. A page-wide `2 · 100%` used to
      // be unique and is not any more: several leaderboards render the same
      // `count · percentage` markup, so an unscoped match is a strict-mode
      // violation the moment another card agrees with this one.
      const topPaths = page.getByTestId("insights-top-paths");
      await expect(topPaths).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Unique visitors")).toBeVisible();
      await expect(topPaths.getByText("/checkout")).toBeVisible();
      // The only page reported, so its two views are 100% of the total.
      await expect(topPaths.getByText(/2\s*·\s*100%/)).toBeVisible();

      // One of those two views was the arrival, which is the whole point of
      // `entries` being a separate measure from `count`.
      await expect(
        page.getByTestId("insights-entries").getByText("1", { exact: true }),
      ).toBeVisible();

      // Entry pages share a card with pages now: six leaderboards in four
      // cards is what buys the overview its density.
      await topPaths
        .getByRole("tab", { name: "Landing pages", exact: true })
        .click();
      await expect(topPaths.getByText(/1\s*·\s*100%/)).toBeVisible();
      await topPaths
        .getByRole("tab", { name: "Top pages", exact: true })
        .click();

      // One engagement against two views, so half of them showed no reader.
      await expect(
        page.getByTestId("insights-bounce").getByText("50%"),
      ).toBeVisible();

      // The arrival's referrer, and the second view which had none.
      const referrers = page.getByTestId("insights-referrers");
      await expect(referrers.getByText("news.ycombinator.com")).toBeVisible();
      // `exact`, because the card's own note also says "Direct".
      await expect(
        referrers.getByText("Direct", { exact: true }),
      ).toBeVisible();

      // Campaigns share the referrers card, for the same reason entry pages
      // share the pages one: they answer the neighbouring question.
      await referrers
        .getByRole("tab", { name: "Campaigns", exact: true })
        .click();
      await expect(referrers.getByText("hn", { exact: true })).toBeVisible();
      await referrers
        .getByRole("tab", { name: "Top referrers", exact: true })
        .click();

      const devices = page.getByTestId("insights-devices");
      await expect(devices.getByText("Mobile")).toBeVisible();

      // Device, browser and system share one card: the same question asked
      // three ways. Both new dimensions sort EARLY, so they only exist at all
      // because the slot map is append-only now.
      await devices.getByRole("tab", { name: "Browsers", exact: true }).click();
      await expect(devices.getByText("safari")).toBeVisible();
      await devices.getByRole("tab", { name: "Systems", exact: true }).click();
      await expect(devices.getByText("ios")).toBeVisible();
      await devices.getByRole("tab", { name: "Devices", exact: true }).click();

      // This deployment runs the relational backend, where `estimated` is
      // always false — the qualifier must not appear. Pins "no false
      // qualifier" as deliberate rather than an untested absence.
      await expect(page.getByText("Estimated")).toHaveCount(0);
    });

    await test.step("the traffic toggle separates crawlers from readers", async () => {
      // A second batch, stamped `bot` the way an app's own proxy stamps it
      // from the user-agent. Posted AFTER the assertions above so it cannot
      // move the numbers they pin.
      const crawl = await request.post(ingest, {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        data: {
          views: [{ path: "/crawled", entry: true }],
          country: "US",
          device: "desktop",
          traffic: "bot",
          visitor: `v-bot-${t}`,
        },
      });
      expect(crawl.status()).toBe(204);

      // Each tab fetches its own window on mount, so the new row only exists
      // on screen after the tab asks again — a reload is the cheapest way to
      // make it ask.
      await page.reload();
      await page.waitForLoadState("networkidle");

      const traffic = page.getByTestId("app-traffic");
      const topPaths = page.getByTestId("insights-top-paths");
      const visitors = page.getByTestId("insights-unique-visitors");
      await expect(topPaths).toBeVisible({ timeout: 15_000 });

      // `all` is the default, and both populations are in it. Two visitors:
      // the reader from the batch above and the crawler from this one.
      await expect(topPaths.getByText("/crawled")).toBeVisible();
      await expect(topPaths.getByText("/checkout")).toBeVisible();
      await expect(visitors.getByText("2", { exact: true })).toBeVisible();

      await traffic.getByRole("button", { name: "Bots", exact: true }).click();
      await expect(topPaths.getByText("/crawled")).toBeVisible();
      await expect(topPaths.getByText("/checkout")).toHaveCount(0);
      // The headline moves with the rest. It did not, until it did.
      await expect(visitors.getByText("1", { exact: true })).toBeVisible();

      await traffic
        .getByRole("button", { name: "Humans", exact: true })
        .click();
      await expect(topPaths.getByText("/checkout")).toBeVisible();
      await expect(topPaths.getByText("/crawled")).toHaveCount(0);
      await expect(visitors.getByText("1", { exact: true })).toBeVisible();

      // Back to `all`, so the steps after this one see the page they expect.
      await traffic.getByRole("button", { name: "All", exact: true }).click();
      await expect(topPaths.getByText("/crawled")).toBeVisible();
    });

    await test.step("the window and the population survive a reload, and stay off Settings", async () => {
      await page
        .getByTestId("app-range")
        .getByRole("button", { name: "30 days", exact: true })
        .click();
      await page
        .getByTestId("app-traffic")
        .getByRole("button", { name: "Humans", exact: true })
        .click();

      // In the URL, which is the whole reason they left the shell: a reload
      // keeps them, and a link carries them.
      await expect(page).toHaveURL(/range=30d/);
      await expect(page).toHaveURL(/traffic=humans/);

      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByTestId("app-range").getByRole("button", { name: "30 days" }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page).toHaveURL(/range=30d/);

      // They cross to Vitals, which reads the same window...
      await page
        .getByTestId("app-tabs")
        .getByRole("link", { name: "Vitals", exact: true })
        .click();
      await expect(page).toHaveURL(/range=30d/, { timeout: 15_000 });

      // ...and do NOT follow to Settings, which has no use for either. A
      // `?range=` trailing onto that page would be the control-that-changes-
      // nothing all over again, in the address bar.
      await page
        .getByTestId("app-tabs")
        .getByRole("link", { name: "Settings", exact: true })
        .click();
      await expect(page).toHaveURL(/\/settings$/, { timeout: 15_000 });

      // Back to Analytics on the default window, so the steps below see the
      // numbers they pin.
      await page.goto(`/${projectSlug}/apps/${appName}/analytics`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("the Explore tab offers the query builder without the scope", async () => {
      await page
        .getByTestId("app-tabs")
        .getByRole("link", { name: "Explore", exact: true })
        .click();
      await expect(page).toHaveURL(/\/explore$/, { timeout: 15_000 });

      // The scoped endpoint answered: `from` lists a dataset, so the
      // descriptors arrived and the member gate let them through.
      const from = page.getByRole("combobox", { name: /pick a dataset/i });
      await expect(from).toContainText("sigil_views", { timeout: 15_000 });

      // The real assertion of the whole feature. `sigilId` is ABSENT from the
      // published descriptor, not hidden by this page, so the group-by chips
      // cannot offer it — while every other dimension is still there. If the
      // pin ever stops stripping the descriptor, this is what goes red, and
      // it goes red before anyone can group a chart by a constant.
      await expect(page.getByTitle("group by path")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTitle("group by country")).toBeVisible();
      await expect(page.getByTitle("group by sigilId")).toHaveCount(0);

      // #1747, feedback #2078: the builder sat in a gutter with a strip of
      // plate showing under it. `AppLayout` used to wrap every tab in a shared
      // `p-4` and hand it a scroll region, and neither is what a two-pane
      // layout that scrolls its own panes wants: `flex-1` inside an
      // `overflow-y-auto` box resolves against the content, so the builder
      // ended up short of the plate rather than filling it.
      //
      // Asserted as the body matching the plate rather than as a class,
      // because the claim is that it FILLS - a right answer reached another
      // way is still a right answer.
      const boxes = await page.evaluate(() => {
        const tabs = document.querySelector('[data-testid="app-tabs"]')!;
        const plate = tabs.closest<HTMLElement>(
          ".flex.min-h-0.w-full.flex-1.flex-col",
        )!;
        const body = plate.lastElementChild as HTMLElement;
        const r = (el: HTMLElement) => {
          const b = el.getBoundingClientRect();
          return {
            left: Math.round(b.left),
            right: Math.round(b.right),
            bottom: Math.round(b.bottom),
          };
        };
        return {
          plate: r(plate),
          body: r(body),
          padding: getComputedStyle(body).padding,
          pageOverflowY:
            document.documentElement.scrollHeight -
            document.documentElement.clientHeight,
        };
      });

      expect(boxes.body.left).toBe(boxes.plate.left);
      expect(boxes.body.right).toBe(boxes.plate.right);
      expect(boxes.body.bottom).toBe(boxes.plate.bottom);
      expect(boxes.padding).toBe("0px");
      // The two panes scroll, the page does not.
      expect(boxes.pageOverflowY).toBe(0);

      // ⚠️ The default window ends YESTERDAY (the last complete UTC day), and
      // everything this run reported was stamped today — so the panel opens on
      // "No data for this query" and that is correct, not a failure. Reaching
      // this run's own rows means moving `until` to today, which lives behind
      // `advanced`.
      await expect(page.getByText(/no data for this query/i)).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: /^advanced/ }).click();
      await page.getByRole("radio", { name: "today", exact: true }).click();

      // Group by path so the rows name something assertable. `day` stays
      // selected, so this is a second key rather than a replacement.
      await page.getByTitle("group by path").click();

      // The pin reached the QUERY, not just the descriptor: `/crawled` was
      // reported by this sigil earlier in the run. The unit spec proves the
      // arithmetic (2 rows, not 11); this proves it survives the real HTTP
      // surface, `$secure` and serialization, which that spec bypasses.
      await expect(page.getByText("/crawled").first()).toBeVisible({
        timeout: 15_000,
      });

      // Back to Analytics on the default window: the step above this one
      // ended there deliberately, so the leaderboard steps below can pin the
      // numbers they expect.
      await page.goto(`/${projectSlug}/apps/${appName}/analytics`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("clicking a leaderboard row narrows the whole page", async () => {
      // The interaction the section exists for: the leaderboards are how a
      // filter is reached, and everything re-queries under it together.
      const topPaths = page.getByTestId("insights-top-paths");
      await topPaths.getByText("/crawled").click();

      const chips = page.getByTestId("insights-filters");
      await expect(chips.getByText("/crawled")).toBeVisible({
        timeout: 15_000,
      });
      // In the URL, so the narrowed view survives a reload and travels in a
      // link.
      await expect(page).toHaveURL(/path=%2Fcrawled/);
      // Narrowed together, not just the chip: the page a filter does not reach
      // would be worse than no filter.
      await expect(topPaths.getByText("/checkout")).toHaveCount(0);

      await chips
        .getByRole("button", { name: /Clear the Page filter/ })
        .click();
      await expect(topPaths.getByText("/checkout")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("insights-filters")).toHaveCount(0);
    });

    await test.step("a card's More link opens that leaderboard in full", async () => {
      await page
        .getByTestId("insights-countries")
        .getByRole("link", { name: "More", exact: true })
        .click();

      await expect(page).toHaveURL(/\/analytics\/country/, {
        timeout: 15_000,
      });
      await expect(page.getByTestId("insights-dimension-table")).toBeVisible({
        timeout: 15_000,
      });

      await page.goBack();
      await page.waitForLoadState("networkidle");
    });

    await test.step("a leaderboard's detail page filters the overview and returns", async () => {
      // Reached by URL rather than by a More link, which the overview does not
      // grow until the Umami-shaped rebuild. The loop this asserts is the one
      // the page exists for: leaderboard row -> filter -> overview.
      await page.goto(`/${projectSlug}/apps/${appName}/analytics/path`);
      await page.waitForLoadState("networkidle");

      const table = page.getByTestId("insights-dimension-table");
      await expect(table.getByText("/checkout")).toBeVisible({
        timeout: 15_000,
      });

      await table.getByText("/checkout").click();

      // Back on the overview, narrowed, with the filter in the URL so it
      // survives a reload and travels in a link.
      await expect(page).toHaveURL(/\/analytics\?.*path=%2Fcheckout/, {
        timeout: 15_000,
      });
      const topPaths = page.getByTestId("insights-top-paths");
      await expect(topPaths.getByText("/checkout")).toBeVisible({
        timeout: 15_000,
      });
      await expect(topPaths.getByText("/crawled")).toHaveCount(0);
    });

    await test.step("an unknown leaderboard is a 404, not a failed request", async () => {
      // The segment is user input on its way to a query. It is refused by the
      // route before anything sees it, so this renders the app's own not-found
      // page rather than a 400 surfacing out of a fetch.
      await page.goto(`/${projectSlug}/apps/${appName}/analytics/nonsense`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("insights-dimension-table")).toHaveCount(0);
    });

    await test.step("the Vitals tab reports a range, a sample count and no rating", async () => {
      // Back to the app page: the two steps above left the browser on a
      // detail URL, and the tab bar is what the rest of this flow drives.
      await page.goto(`/${projectSlug}/apps/${appName}`);
      await page.waitForLoadState("networkidle");

      await page
        .getByTestId("app-tabs")
        .getByRole("link", { name: "Vitals", exact: true })
        .click();

      // ⚠️ The route, not just the tab. `$page` renames are not
      // typecheck-protected: `router.path` widens to the plain `string`
      // overload the moment a name stops existing, so nothing but an assertion
      // like this one would notice `/vitals` regressing. The suite never
      // referenced the old `/performance` either, which is why this had to be
      // written rather than edited.
      await expect(page).toHaveURL(/\/apps\/[^/]+\/vitals/, {
        timeout: 15_000,
      });
      await expect(page.getByText("Web Vitals")).toBeVisible({
        timeout: 15_000,
      });

      const lcp = page.getByTestId("vitals-lcp");
      // The 2100 ms sample lands in the ≤2500 bucket, so the honest answer is
      // the width of that bucket rather than its ceiling. The old page printed
      // "2,500 ms" flat, which is what made five unrelated production apps all
      // report the same figure. The thousands separator is the browser's.
      await expect(
        lcp.getByText(/1[,.\s]?800\s+to\s+2[,.\s]?500\s*ms/),
      ).toBeVisible();
      await expect(lcp.getByText("1 samples")).toBeVisible();
      // One sample is not a measurement, and the card must not dress it as one.
      await expect(lcp.getByText("Low confidence")).toBeVisible();
      for (const rating of ["Good", "Needs work", "Poor"]) {
        await expect(lcp.getByText(rating, { exact: true })).toHaveCount(0);
      }

      // INP needs a real interaction, which this flow never performs. Saying so
      // is a state; an empty card reads as a broken one.
      await expect(
        page.getByTestId("vitals-inp").getByText("No interaction samples yet"),
      ).toBeVisible();

      // The half that says WHERE. `path` has been on every vitals sample since
      // the dataset existed and no query ever grouped by it.
      const paths = page.getByTestId("vitals-paths");
      await expect(paths.getByText("/checkout")).toBeVisible({
        timeout: 15_000,
      });
      // One sample, so the row is marked rather than presented as a finding.
      await expect(paths.getByText("Low confidence")).toBeVisible();

      // The asymmetry with Analytics, said on the tab rather than left to be
      // discovered: that tab can exclude crawlers and this one cannot.
      await expect(page.getByText(/crawlers included/i)).toBeVisible();
    });

    await test.step("an app without Beacon has no analytics tabs, and gets them back", async () => {
      // Flipped through the API: the four capability switches left the
      // Settings page with the rebuild (they were a second, unaware copy of a
      // decision `SIGIL_CONFIG` already makes). The GATE did not move, so what
      // it does to the page is still worth guarding.
      await setSigilKinds(page, projectId, appName, ["feedback"]);
      await waitForSigilKind(page, projectId, appName, "beacon", false);

      await page.goto(`/${projectSlug}/apps/${appName}`);
      await page.waitForLoadState("networkidle");

      const tabs = page.getByTestId("app-tabs");
      for (const label of ["Analytics", "Vitals"]) {
        await expect(
          tabs.getByRole("link", { name: label, exact: true }),
        ).toHaveCount(0, { timeout: 15_000 });
      }

      await setSigilKinds(page, projectId, appName, [
        "feedback",
        "blights",
        "beacon",
        "vitals",
      ]);
      await waitForSigilKind(page, projectId, appName, "beacon", true);

      await page.goto(`/${projectSlug}/apps/${appName}`);
      await page.waitForLoadState("networkidle");
      for (const label of ["Analytics", "Vitals"]) {
        await expect(
          tabs.getByRole("link", { name: label, exact: true }),
        ).toBeVisible({ timeout: 15_000 });
      }

      // Regression guard for a real bug (Task 6): the insights payload used to
      // be filled by the `projectApp` loader alone, and a sibling-tab
      // navigation reused that loader's layer instead of re-running it, so the
      // data stayed stale after Beacon flipped back on and Analytics rendered
      // blank. Analytics fetching on its own mount is what removed the whole
      // class — assert the tab renders content, not just that the link exists.
      await tabs.getByRole("link", { name: "Analytics", exact: true }).click();
      await expect(page.getByText("Top pages")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("/checkout").first()).toBeVisible();
    });

    let rotated = "";
    await test.step("renaming the app moves its page and its sidebar entry", async () => {
      await page.goto(`/${projectSlug}/apps/${appName}/settings`);
      await page.waitForLoadState("networkidle");

      const field = page.getByRole("textbox", { name: "Name", exact: true });
      await expect(field).toBeVisible({ timeout: 15_000 });
      await field.fill(`${appName}-renamed`);
      await page.getByRole("button", { name: "Rename", exact: true }).click();
      await confirmDialog(page, "Rename");

      // The name is the URL segment, so a rename moves the page. Leaving the
      // old address in the bar would leave a 404 behind.
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/apps/${appName}-renamed/settings`),
        { timeout: 15_000 },
      );
      // Both atoms, not just the page's: the sidebar renders from the other
      // one and the two must not disagree. Scoped to the sidebar entry itself,
      // because the breadcrumb carries the same NAME and the Dashboard tab
      // carries the same HREF - either alone is a strict-mode violation the
      // moment the rename lands everywhere it should.
      await expect(
        page.locator(
          `[data-sidebar="menu-sub-button"][href="/${projectSlug}/apps/${appName}-renamed/"]`,
        ),
      ).toBeVisible({ timeout: 15_000 });

      // Back, so the rest of this flow keeps addressing the app by `appName`.
      await field.fill(appName);
      await page.getByRole("button", { name: "Rename", exact: true }).click();
      await confirmDialog(page, "Rename");
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/apps/${appName}/settings`),
        { timeout: 15_000 },
      );
    });

    await test.step("renaming onto a taken name is refused, and says so", async () => {
      // A second app to collide with. `(projectId, name)` is a unique index,
      // so without a check before the write this would surface as a driver
      // constraint violation — a 500 for what is the operator's typo.
      // Enrolled through the API rather than the dialog: the dialog has its own
      // step several hundred lines up, and re-driving it here would test the
      // enrolment form a second time instead of the collision.
      const taken = `${appName}-two`;
      const enrolled = await page.evaluate(
        async ({ projectId, name }) => {
          const r = await fetch(`/api/projects/${projectId}/sigils`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name }),
          });
          return r.ok;
        },
        { projectId, name: taken },
      );
      expect(enrolled).toBe(true);

      await page.goto(`/${projectSlug}/apps/${appName}/settings`);
      await page.waitForLoadState("networkidle");
      const field = page.getByRole("textbox", { name: "Name", exact: true });
      await field.fill(taken);
      await page.getByRole("button", { name: "Rename", exact: true }).click();
      await confirmDialog(page, "Rename");

      await expect(page.getByText(/already exists named/)).toBeVisible({
        timeout: 15_000,
      });
      // Refused, not half-applied: the page is still the app it was.
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/apps/${appName}/settings`),
      );

      // Retired again, so the delete step at the end of this flow still lands
      // on a project with nothing enrolled — which is the state its own
      // assertions are about.
      const removed = await page.evaluate(
        async ({ projectId, name }) => {
          const list = await fetch(`/api/projects/${projectId}/sigils`, {
            credentials: "include",
          });
          const body = (await list.json()) as {
            items: { id: string; name: string }[];
          };
          const sigil = body.items.find((it) => it.name === name);
          if (!sigil) return false;
          const r = await fetch(
            `/api/projects/${projectId}/sigils/${sigil.id}`,
            { method: "DELETE", credentials: "include" },
          );
          return r.ok;
        },
        { projectId, name: taken },
      );
      expect(removed).toBe(true);
    });

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
      await page.goto(`/${projectSlug}/blights`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(blightMessage)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("deleting the sigil retires its token", async () => {
      // Back to the app's Settings tab — the same page rotate was driven
      // from. Still one app, so the group is still open by default — no
      // click needed to reach the link.
      await page.goto(`/${projectSlug}`);
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
        new RegExp(`/${projectSlug}/settings/sigils`),
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
      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/blights`), {
        timeout: 15_000,
      });
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(blightMessage)).toBeVisible({
        timeout: 15_000,
      });
    });
  });
});
