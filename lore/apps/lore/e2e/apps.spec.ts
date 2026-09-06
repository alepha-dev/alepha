import { sigilKeyPrefix, sigilKeyProject } from "@alepha/lore/sigil";
import type { Page, Request } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * Apps, end to end: create a deployed copy, add a second, mint the key one of
 * them reports with, report as it, triage what arrives, rotate, remove, delete.
 *
 * The surface under test: an **app instance** is `(app, env)`, both required,
 * created by typing two names and minting nothing. A **sigil** is an optional
 * unlock on one of those - an `sg_` bearer token, shown exactly once and stored
 * hashed - and its presence is what puts Analytics, Vitals, Errors and Explore
 * on the tab bar. Ingest is a root `$route` (`POST /sigils/ingest`),
 * authenticated by that token and by nothing else.
 *
 * ⚠️ **This file was `sigil.spec.ts`, rewritten in place rather than doubled.**
 * Its first two steps drove a project-settings enrol page that #1770 deleted;
 * everything from ingest onwards is the only e2e coverage of the ingest path
 * and survives on top of the new creation flow.
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
 * The rows of the Apps list carrying a string.
 *
 * Scoped to the table rather than to `page.getByText(...)`, because a refusal
 * message embeds the pair it is refusing, so a page-wide count of `hello`
 * counts the error toast as well as the row. The question this list answers is
 * *how many rows*.
 */
const appRows = (page: Page, text: string) =>
  page.getByTestId("apps-table").locator("tbody tr").filter({ hasText: text });

/**
 * Poll `GET /api/projects/:projectId/apps` until the pair is present or gone.
 *
 * Same shape as {@link waitForProjectFeature}, one level down, and for the same
 * reason: every `$action` the SPA makes is multiplexed through
 * `POST /api/_batch`, so `waitForResponse` on a per-action URL never fires.
 * Read the state back from the plain GET route instead.
 *
 * ⚠️ **`cache: "no-store"`, and it is load-bearing.** Without it the browser
 * serves a poll from its own HTTP cache, so the loop settles on the state
 * BEFORE the write it is waiting for and the next step races it. That cost an
 * hour on the estate step below, where a cleared deploy target read as cleared
 * and the server refused the detach anyway.
 */
const waitForInstance = async (
  page: Page,
  projectId: number,
  app: string,
  env: string,
  present: boolean,
): Promise<void> => {
  await expect
    .poll(
      async () =>
        page.evaluate(
          async ({ projectId, app, env }) => {
            const r = await fetch(`/api/projects/${projectId}/apps`, {
              cache: "no-store",
              credentials: "include",
            });
            if (!r.ok) return undefined;
            const body = (await r.json()) as {
              items: { app: string; env: string }[];
            };
            return body.items.some((it) => it.app === app && it.env === env);
          },
          { projectId, app, env },
        ),
      { timeout: 15_000 },
    )
    .toBe(present);
};

/**
 * Creates an instance through the API.
 *
 * The dialog has its own step; re-driving it wherever a second copy is needed
 * would test the create form over and over instead of the thing under test.
 */
const createInstance = async (
  page: Page,
  projectId: number,
  app: string,
  env: string,
): Promise<void> => {
  const ok = await page.evaluate(
    async ({ projectId, app, env }) => {
      const r = await fetch(`/api/projects/${projectId}/apps`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app, env }),
      });
      return r.ok;
    },
    { projectId, app, env },
  );
  expect(ok).toBe(true);
};

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
              cache: "no-store",
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
      // `sigils.name` is the `"<app>/<env>"` mirror since Apps v3, so the
      // caller passes the pair and this matches it verbatim.
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
              cache: "no-store",
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

test.describe("Apps", () => {
  test("create a copy, mint its key, report as it, remove it", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const t = Date.now();
    const email = `sigil${t}@example.com`;
    const projectTitle = `Sig${t}`.slice(0, 20);
    // Distinct from the project title so `getByText` cannot match the header,
    // and constrained to `APP_NAME_PATTERN`: both halves are URL segments
    // (`/:projectSlug/apps/:app/:env`), so a capital or a space is refused
    // rather than just cosmetic.
    const appName = `app-${t}`;
    const envName = "world";
    const secondEnv = "staging";
    // What `sigils.name` mirrors, and what `setSigilKinds` looks a credential
    // up by.
    const pair = `${appName}/${envName}`;
    const blightMessage = `SigilE2E_${t} is not a function`;
    // ⚠️ Unique per run: `(ownerUserId, slug)` is a unique index, and the suite
    // shares a worker's database with nothing but itself only because every
    // fixture here is stamped with `t`.
    const estateSlug = `ovh-${t}`.slice(0, 20);

    await registerAndVerify(page, email, "SigilTest123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const ingest = `${baseURL}/sigils/ingest`;

    await test.step("the owner turns Apps on, from a page that no longer enrols", async () => {
      await page.goto(`/${projectSlug}/settings/sigils`);
      await page.waitForLoadState("networkidle");

      // The settings page rendering at all is worth asserting: removing this
      // route without editing the nav array crashed every settings page once.
      // ⚠️ The route name and path still say `sigils` while the page says Apps,
      // which is deliberate - a `$page` rename is not typecheck-protected.
      await expect(
        page.getByRole("switch", { name: "Enable", exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      await page.getByRole("switch", { name: "Enable", exact: true }).click();

      // The switch's own `checked` state is optimistic (see
      // `waitForProjectFeature`) — wait on the server directly, since
      // everything from here on (creating, ingest's config gate, the app and
      // blights route loaders, the sidebar's Apps entry) depends on
      // `features.sigils` actually being on, not just the switch looking on.
      await waitForProjectFeature(page, projectId, "sigils", true);

      // ⚠️ The enrol block and the credential list are GONE (#1770). Creating a
      // deployed copy is what /apps is for, and a list of the same things here
      // was a second door onto one room. What survives is the switch and the
      // ignore rules, which are project-scoped and cannot follow a sigil down
      // to an instance.
      await expect(page.getByText(/Ignore rules/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByRole("button", { name: "Enroll", exact: true }),
      ).toHaveCount(0);
    });

    await test.step("New app creates a copy from two names, and mints nothing", async () => {
      await page.goto(`/${projectSlug}`);
      await page.waitForLoadState("networkidle");

      // The header's existing "+", not a second button beside it.
      await page.getByTestId("project-create-menu").click();
      await page
        .getByRole("menuitem", { name: "New app", exact: true })
        .click();

      // ⚠️ Named, not `getByRole("dialog")`: the combobox popup below is also
      // `role="dialog"`, so the bare role is a strict-mode violation the moment
      // it opens.
      const dialog = page.getByRole("dialog", { name: "New app" });
      await expect(dialog).toBeVisible({ timeout: 15_000 });

      // The app field is a combobox over the names that already exist, with an
      // explicit create-new row: without it a typo silently makes a second app,
      // since `club` and `clbu` are two apps and nothing complains.
      await dialog.getByRole("combobox").click();
      // ⚠️ The popup is a portal, so it is not under the dialog, and BOTH the
      // trigger and the popup's search field carry `role="combobox"` - reaching
      // by role alone can land on the button, which `fill` refuses.
      const search = page.locator('input[role="combobox"]');
      await expect(search).toBeVisible({ timeout: 15_000 });
      await search.fill(appName);
      await page
        .getByRole("option")
        .filter({ hasText: appName })
        .first()
        .click();

      // ⚠️ By id, not by label: `Control` renders a required field's label as
      // "Environment*", so `getByLabel(..., { exact: true })` matches nothing.
      await dialog.locator("#app-create-env").fill(envName);
      await dialog.getByRole("button", { name: "Create", exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      // Base UI leaves `pointer-events: none` behind after the combobox popover
      // and the dialog close; the next click is otherwise the flaky one.
      await releasePointerEvents(page);

      // Landed on the instance it just made.
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/apps/${appName}/${envName}`),
        { timeout: 15_000 },
      );
      await waitForInstance(page, projectId, appName, envName, true);
    });

    await test.step("a copy with nothing unlocked has three tabs and next steps", async () => {
      // ⚠️ Assert the bar RENDERED before asserting what is missing from it: a
      // negative assertion passes happily against a page that has not painted.
      const tabs = page.getByTestId("app-tabs");
      await expect(
        tabs.getByRole("link", { name: "Overview", exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      for (const label of ["Artifacts", "Settings"]) {
        await expect(
          tabs.getByRole("link", { name: label, exact: true }),
        ).toBeVisible();
      }
      for (const label of ["Analytics", "Vitals", "Errors", "Explore"]) {
        await expect(
          tabs.getByRole("link", { name: label, exact: true }),
        ).toHaveCount(0);
      }

      // Not a card grid with holes in it: both Overview cards read a sigil, and
      // this is the normal state right after creation.
      await expect(page.getByTestId("app-next-steps")).toBeVisible({
        timeout: 15_000,
      });

      // ⚠️ And it reads as "nothing reports", never as "silent". A copy with no
      // sigil has no `lastSeenAt`, never will, and the old two-state check
      // rendered it as a fault forever.
      await page.goto(`/${projectSlug}/apps`);
      await page.waitForLoadState("networkidle");
      const dot = page
        .getByTestId("apps-table")
        .locator('[role="img"][data-state]')
        .first();
      await expect(dot).toHaveAttribute("data-state", "none", {
        timeout: 15_000,
      });
      await expect(dot).toHaveAttribute("aria-label", /no sigil/i);
    });

    await test.step("a second copy of the same app is a second flat row", async () => {
      await createInstance(page, projectId, appName, secondEnv);
      await page.goto(`/${projectSlug}/apps`);
      await page.waitForLoadState("networkidle");

      // Flat: two rows, the app name repeating rather than blank-filled,
      // because a blank cell breaks sorting on every other column.
      await expect(appRows(page, appName)).toHaveCount(2, { timeout: 15_000 });
      await expect(appRows(page, envName)).toHaveCount(1);
      await expect(appRows(page, secondEnv)).toHaveCount(1);
    });

    await test.step("the name filter matches the env half too", async () => {
      // What makes a tenant-ish substring find anything at all: the app half is
      // the same on both rows.
      const search = page.getByRole("textbox", { name: "Search", exact: true });
      await search.fill(secondEnv);

      await expect(appRows(page, appName)).toHaveCount(1, { timeout: 15_000 });
      await appRows(page, secondEnv).first().click();
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/apps/${appName}/${secondEnv}`),
        { timeout: 15_000 },
      );
    });

    let token = "";
    await test.step("creating a sigil unlocks four tabs, on that copy only", async () => {
      await page.goto(`/${projectSlug}/apps/${appName}/${envName}/settings`);
      await page.waitForLoadState("networkidle");

      await page
        .getByRole("button", { name: "Create a sigil", exact: true })
        .click();

      token = await takeMintedToken(page);
      // The minted token names the project it reports into, which is what
      // spares the app a second variable saying so. Asserted here rather than
      // only in the unit specs because this is the one place the whole chain
      // runs: a real project, its real slug, and the token an operator copies.
      expect(sigilKeyProject(token)).toBeTruthy();
      expect(sigilKeyPrefix(token)).toBeTruthy();

      // ⚠️ A navigation, not a re-render: wait for the bar rather than
      // asserting straight after the click.
      await page.goto(`/${projectSlug}/apps/${appName}/${envName}`);
      await page.waitForLoadState("networkidle");
      const tabs = page.getByTestId("app-tabs");
      for (const label of ["Analytics", "Vitals", "Errors", "Explore"]) {
        await expect(
          tabs.getByRole("link", { name: label, exact: true }),
        ).toBeVisible({ timeout: 15_000 });
      }

      // And NOT on the sibling: an unlock belongs to one deployed copy.
      await page.goto(`/${projectSlug}/apps/${appName}/${secondEnv}`);
      await page.waitForLoadState("networkidle");
      const siblingTabs = page.getByTestId("app-tabs");
      await expect(
        siblingTabs.getByRole("link", { name: "Overview", exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      for (const label of ["Analytics", "Vitals", "Errors", "Explore"]) {
        await expect(
          siblingTabs.getByRole("link", { name: label, exact: true }),
        ).toHaveCount(0);
      }
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
      await page.goto(`/${projectSlug}/apps/${appName}/${envName}/errors`);
      await page.waitForLoadState("networkidle");

      const group = page.getByTestId("app-error-group");
      await expect(group).toHaveCount(1, { timeout: 15_000 });
      await expect(group).toContainText(blightMessage);
      // The occurrence count, which the card this replaced never showed: it
      // rendered `errorGroups.length` and nothing from inside a group.
      await expect(group).toContainText("3");

      // And the card is gone from the page it was asked to leave.
      await page.goto(`/${projectSlug}/apps/${appName}/${envName}/analytics`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("insights-errors")).toHaveCount(0);
    });

    await test.step("the plate now says the copy reported", async () => {
      // The credential list this used to read is gone with the enrol page
      // (#1770); last-reported is on the instance's own plate, pushed to the
      // right edge, and absent rather than "never" when there is no sigil.
      await page.goto(`/${projectSlug}/apps/${appName}/${envName}`);
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

    await test.step("the sidebar's Apps entry opens the list, and the list the copy", async () => {
      // ⚠️ One entry, not a group. It used to expand one child per app, which
      // is a list that grows without bound in the one piece of chrome that must
      // not; the list page is the search surface now and this is its door.
      await page.goto(`/${projectSlug}`);
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByRole("button", { name: "Apps", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("link", { name: "Apps", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/apps$`), {
        timeout: 15_000,
      });

      await appRows(page, envName).first().click();
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/apps/${appName}/${envName}`),
        { timeout: 15_000 },
      );

      // Every tab exists. Scoped to the tab bar: "Settings" is also a
      // project-level sidebar entry, so a page-wide match proves nothing.
      const tabs = page.getByTestId("app-tabs");
      for (const label of [
        "Overview",
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

    await test.step("the breadcrumb mirrors the route, with the app half inert", async () => {
      const crumbs = page.getByLabel("breadcrumb");
      // ⚠️ Four segments, and `${appName}` is a plain LABEL: `/apps/:app`
      // redirects to a sibling copy, so a link there would move the reader
      // sideways rather than up.
      //
      // Asserted on the HREF, not on the role: shadcn's `BreadcrumbPage` marks
      // an inert crumb `role="link" aria-disabled`, so "is it a link" is true of
      // both halves and says nothing. What separates them is where they go.
      const appCrumb = crumbs.getByText(appName, { exact: true });
      await expect(appCrumb).toBeVisible({ timeout: 15_000 });
      await expect(appCrumb).not.toHaveAttribute("href", /./);
      await expect(crumbs.getByText(envName, { exact: true })).toBeVisible();

      await crumbs.getByRole("link", { name: "Apps", exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/apps$`), {
        timeout: 15_000,
      });
      const table = page.getByTestId("apps-table");
      await expect(
        table.getByRole("link", { name: appName }).first(),
      ).toBeVisible({
        timeout: 15_000,
      });
      // The address it reported, resolved the same way the plate does.
      await expect(table.getByText("docs.alepha.dev")).toBeVisible();

      // #1751, feedback #2081: the heading is gone, because the breadcrumb
      // already says "Apps" two lines up and no other project list carries one.
      await expect(table.locator("h1")).toHaveCount(0);

      // A row is a LINE. The Reports column that used to stack four badges into
      // one is cut entirely now, and the three that remain are single values -
      // measured rather than asserted on a class, because a row that fits is
      // the claim.
      const rowHeight = await table
        .locator("tbody tr")
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().height));
      expect(rowHeight).toBeLessThan(60);

      // Back to the copy, which the rest of this flow addresses directly.
      await appRows(page, envName).first().click();
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/apps/${appName}/${envName}`),
        { timeout: 15_000 },
      );
    });

    await test.step("the Dashboard shows state, and asks the server for no analytics", async () => {
      // The property the page was rebuilt for. It used to render three
      // counters out of an insights payload, so opening the front page of an
      // app cost ten aggregate queries against Analytics Engine.
      const calls = await insightsCalls(page, async () => {
        await page.goto(`/${projectSlug}/apps/${appName}/${envName}`);
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

      const field = page.getByRole("textbox", { name: "Address", exact: true });
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
        async ({ projectId, app, env }) => {
          const r = await fetch(`/api/projects/${projectId}/apps`, {
            cache: "no-store",
            credentials: "include",
          });
          const body = (await r.json()) as {
            items: { app: string; env: string; url?: string | null }[];
          };
          return (
            body.items.find((it) => it.app === app && it.env === env)?.url ??
            null
          );
        },
        { projectId, app: appName, env: envName },
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
      await page.goto(`/${projectSlug}/apps/${appName}/${envName}/analytics`);
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
      await page.goto(`/${projectSlug}/apps/${appName}/${envName}/analytics`);
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
      await page.goto(
        `/${projectSlug}/apps/${appName}/${envName}/analytics/path`,
      );
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
      await page.goto(
        `/${projectSlug}/apps/${appName}/${envName}/analytics/nonsense`,
      );
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("insights-dimension-table")).toHaveCount(0);
    });

    await test.step("the Vitals tab reports a range, a sample count and no rating", async () => {
      // Back to the app page: the two steps above left the browser on a
      // detail URL, and the tab bar is what the rest of this flow drives.
      await page.goto(`/${projectSlug}/apps/${appName}/${envName}`);
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
      await expect(page).toHaveURL(/\/apps\/[^/]+\/[^/]+\/vitals/, {
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
      await setSigilKinds(page, projectId, pair, ["feedback"]);
      await waitForSigilKind(page, projectId, pair, "beacon", false);

      await page.goto(`/${projectSlug}/apps/${appName}/${envName}`);
      await page.waitForLoadState("networkidle");

      const tabs = page.getByTestId("app-tabs");
      for (const label of ["Analytics", "Vitals"]) {
        await expect(
          tabs.getByRole("link", { name: label, exact: true }),
        ).toHaveCount(0, { timeout: 15_000 });
      }

      await setSigilKinds(page, projectId, pair, [
        "feedback",
        "blights",
        "beacon",
        "vitals",
      ]);
      await waitForSigilKind(page, projectId, pair, "beacon", true);

      await page.goto(`/${projectSlug}/apps/${appName}/${envName}`);
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
    await test.step("renaming either half moves the page", async () => {
      await page.goto(`/${projectSlug}/apps/${appName}/${envName}/settings`);
      await page.waitForLoadState("networkidle");

      // The ENV half, which is the one that tells two copies of an app apart.
      const field = page.getByRole("textbox", {
        name: "Environment",
        exact: true,
      });
      await expect(field).toBeVisible({ timeout: 15_000 });
      await field.fill("renamed");
      // Scoped: the two rename rows are the same component twice, so their
      // buttons carry the same label.
      await page
        .getByTestId("app-settings-rename-env")
        .getByRole("button", { name: "Rename", exact: true })
        .click();
      await confirmDialog(page, "Rename");

      // Both halves are the URL, so a rename moves the page. Leaving the old
      // address in the bar would leave a 404 behind.
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/apps/${appName}/renamed/settings`),
        { timeout: 15_000 },
      );
      // Both atoms, not just the page's: the list renders from the other one
      // and the two must not disagree.
      await waitForInstance(page, projectId, appName, "renamed", true);

      // Back, so the rest of this flow keeps addressing the copy by its pair.
      await field.fill(envName);
      // Scoped: the two rename rows are the same component twice, so their
      // buttons carry the same label.
      await page
        .getByTestId("app-settings-rename-env")
        .getByRole("button", { name: "Rename", exact: true })
        .click();
      await confirmDialog(page, "Rename");
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/apps/${appName}/${envName}/settings`),
        { timeout: 15_000 },
      );
    });

    await test.step("renaming onto a taken pair is refused, and says so", async () => {
      // The sibling copy created several steps up is the thing to collide with.
      // `(projectId, app, env)` is a unique index, so without a check before
      // the write this would surface as a driver constraint violation - a 500
      // for what is the operator's typo.
      const field = page.getByRole("textbox", {
        name: "Environment",
        exact: true,
      });
      await field.fill(secondEnv);
      // Scoped: the two rename rows are the same component twice, so their
      // buttons carry the same label.
      await page
        .getByTestId("app-settings-rename-env")
        .getByRole("button", { name: "Rename", exact: true })
        .click();
      await confirmDialog(page, "Rename");

      await expect(page.getByText(/already exists/)).toBeVisible({
        timeout: 15_000,
      });
      // Refused, not half-applied: the page is still the copy it was.
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/apps/${appName}/${envName}/settings`),
      );
      await waitForInstance(page, projectId, appName, envName, true);
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

    await test.step("removing the sigil retires its token and keeps the copy", async () => {
      // ⚠️ Before Apps v3 this removed the APP. It removes a credential now:
      // the foreign key is `set null`, so the deployed copy survives with its
      // four unlocked tabs gone. An agent or an operator following an old note
      // must not be surprised silently.
      await page.goto(`/${projectSlug}/apps/${appName}/${envName}/settings`);
      await page.waitForLoadState("networkidle");

      await page
        .getByRole("button", { name: "Delete", exact: true })
        .first()
        .click();
      await confirmDialog(page, "Delete");

      // The instance is still here, and its tab bar has shrunk back to three.
      await page.goto(`/${projectSlug}/apps/${appName}/${envName}`);
      await page.waitForLoadState("networkidle");
      const tabs = page.getByTestId("app-tabs");
      await expect(
        tabs.getByRole("link", { name: "Overview", exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      for (const label of ["Analytics", "Vitals", "Errors", "Explore"]) {
        await expect(
          tabs.getByRole("link", { name: label, exact: true }),
        ).toHaveCount(0);
      }
      await waitForInstance(page, projectId, appName, envName, true);

      const revoked = await request.post(ingest, {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${rotated}`,
        },
        data: { views: [{ path: "/" }] },
      });
      expect(revoked.status()).toBe(401);

      // Blights survive the credential that filed them - `blights.sigilId` is
      // `ON DELETE SET NULL`, because a triage decision is not the sigil's -
      // and the inbox is still reachable from the sidebar. Deriving that entry
      // from the enrolled apps alone would have hidden an inbox that still
      // holds crashes.
      const blightsEntry = page.getByRole("link", {
        name: "Blights",
        exact: true,
      });
      await expect(blightsEntry).toBeVisible({ timeout: 15_000 });
      await blightsEntry.click();
      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/blights`), {
        timeout: 15_000,
      });
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(blightMessage)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("an estate cannot be detached while a copy deploys to it", async () => {
      // ⚠️ The only path that drives `EstateService.assertUnreferenced`. It was
      // a seam doing nothing until #1767 filled it, and without the estate
      // select on the instance's Settings tab there would be no user path to
      // reach either refusal.
      await page.goto(`/${projectSlug}/settings/estates`);
      await page.waitForLoadState("networkidle");

      await page
        .getByRole("button", { name: "Add an estate", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      // The caller owns no estate yet, so the dialog opens on "create a new
      // one" - clicked explicitly rather than relied on, since the mode it
      // lands in depends on what the account happens to hold.
      await dialog
        .getByRole("button", { name: "Create a new one", exact: true })
        .click();
      await dialog
        .getByRole("textbox", { name: "Estate slug" })
        .fill(estateSlug);
      await dialog
        .getByRole("button", { name: "Create and lend", exact: true })
        .click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await releasePointerEvents(page);
      // The secret is shown once, like a token, and dismissing it is what
      // finishes the flow.
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await releasePointerEvents(page);
      await expect(page.getByText(estateSlug).first()).toBeVisible({
        timeout: 15_000,
      });

      // Point the copy at it.
      await page.goto(`/${projectSlug}/apps/${appName}/${envName}/settings`);
      await page.waitForLoadState("networkidle");
      const select = page.locator("[data-slot=select-trigger]");
      await expect(select).toBeVisible({ timeout: 15_000 });
      await select.click();
      await page.getByRole("option", { name: estateSlug }).click();
      await releasePointerEvents(page);
      await expect(page.getByText(/Deploy target saved/i)).toBeVisible({
        timeout: 15_000,
      });

      // Refused, and the message NAMES the copy, because the operator's next
      // action is to open it and repoint it.
      const detached = await page.evaluate(
        async ({ projectId }) => {
          const list = await fetch(`/api/projects/${projectId}/estates`, {
            cache: "no-store",
            credentials: "include",
          });
          const body = (await list.json()) as { items: { id: string }[] };
          const estate = body.items[0];
          const r = await fetch(
            `/api/projects/${projectId}/estates/${estate.id}`,
            { method: "DELETE", credentials: "include" },
          );
          return { status: r.status, body: await r.text() };
        },
        { projectId },
      );
      expect(detached.status).toBe(409);
      expect(detached.body).toContain(`${appName}/${envName}`);

      // Cleared, and the detach goes through.
      //
      // ⚠️ Waited on the SERVER, not on the toast: one is already on screen
      // from the save above, so `toBeVisible` is satisfied by the wrong one and
      // the detach below races the PATCH. That cost an hour, reading as a
      // refusal that never lifts.
      await select.click();
      await page
        .getByRole("option", { name: "No estate", exact: true })
        .click();
      await releasePointerEvents(page);
      await expect
        .poll(
          async () =>
            page.evaluate(
              async ({ projectId, app, env }) => {
                const r = await fetch(`/api/projects/${projectId}/apps`, {
                  cache: "no-store",
                  credentials: "include",
                });
                if (!r.ok) return undefined;
                const body = (await r.json()) as {
                  items: {
                    app: string;
                    env: string;
                    estateId?: string | null;
                  }[];
                };
                return (
                  body.items.find((it) => it.app === app && it.env === env)
                    ?.estateId ?? null
                );
              },
              { projectId, app: appName, env: envName },
            ),
          { timeout: 15_000 },
        )
        .toBeNull();

      const again = await page.evaluate(
        async ({ projectId }) => {
          const list = await fetch(`/api/projects/${projectId}/estates`, {
            cache: "no-store",
            credentials: "include",
          });
          const body = (await list.json()) as { items: { id: string }[] };
          const estate = body.items[0];
          const r = await fetch(
            `/api/projects/${projectId}/estates/${estate.id}`,
            { method: "DELETE", credentials: "include" },
          );
          return r.status;
        },
        { projectId },
      );
      expect(again).toBe(200);
    });

    await test.step("deleting both copies empties the list", async () => {
      for (const env of [envName, secondEnv]) {
        await page.goto(`/${projectSlug}/apps/${appName}/${env}/settings`);
        await page.waitForLoadState("networkidle");

        await page
          .getByRole("button", { name: "Delete", exact: true })
          .last()
          .click();
        await confirmDialog(page, "Delete");

        // The page's subject no longer exists, so it lands on the list.
        await expect(page).toHaveURL(new RegExp(`/${projectSlug}/apps$`), {
          timeout: 15_000,
        });
        await waitForInstance(page, projectId, appName, env, false);
      }

      // ⚠️ Empty, and rendered as empty rather than as a failed read: an empty
      // state on a transient failure would claim a project has no apps.
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(/No app yet/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/Couldn/i)).toHaveCount(0);
    });
  });
});
