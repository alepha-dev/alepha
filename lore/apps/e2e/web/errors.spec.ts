import { expect, test } from "./_fixtures.ts";
import {
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * Regression guard for the Errors inbox infinite render loop.
 *
 * `ProjectErrors` pushes the open-count to the sidebar badge atom from its
 * DataTable `fetch`. It used to do so via a *subscribing* `useStore`, so each
 * fetch re-rendered the component → new inline `fetch` prop → refetch → write
 * badge → … an infinite loop. The fix: write the badge with a non-subscribing
 * `store.set`, and DataTable treats `fetch` as a latest-wins data source.
 *
 * A render loop throws "Maximum update depth exceeded" → the error boundary,
 * so the inbox chrome never renders. We assert the chrome IS visible and the
 * crash screen is NOT.
 *
 * Scope: this file guards the inbox *component*. Filing an error and watching
 * it arrive belongs to the credential that files it, and lives in
 * `apps.spec.ts` — which covers the ingest → inbox → merge path end to end.
 * The previous second test here drove `POST /api/c/:id/sources` and
 * `POST /api/errors/ingest`, both deleted with the source model.
 *
 * The second test here is the error's own page (#E185): from the inbox to
 * `/errors/:id`, and a resolve made from it. It reports one error itself, as
 * an enrolled app would, because the page has nothing to show without one.
 */
test.describe("Errors", () => {
  test("inbox renders without an infinite render loop", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `error${t}@example.com`;
    const projectTitle = `BL${t}`.slice(0, 20);

    await registerAndVerify(page, email, "ProjectErrorTest123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    // `projectErrors` rides the Ship capability, not a errors switch of its
    // own: errors only ever arrive from an enrolled app. Deliberately
    // relaxed this way - deriving the gate from whether any app currently
    // carries the `projectErrors` kind would turn a transient `listSigils` failure
    // into a 404 on a deep link.
    await setCapability(page, projectId, "ship", { options: { track: true } });

    await page.goto(`/${projectSlug}/errors`);
    await page.waitForLoadState("networkidle");

    // Inbox chrome renders (status filter defaults to "Open"; the empty-state
    // message shows for a project with no errors) → the page is stable.
    await expect(page.getByText("Open").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("No open errors")).toBeVisible({
      timeout: 10_000,
    });
    // ...and it did NOT spin into "Maximum update depth" → error boundary.
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });

  test("an error opens on its own page, and is resolved from it", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const email = `errorpage${t}@example.com`;
    const message = `cart is undefined ${t}`;

    await registerAndVerify(page, email, "ProjectErrorTest123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      `EP${t}`.slice(0, 20),
    );
    await setCapability(page, projectId, "ship", { options: { track: true } });

    // One deployed copy and its sigil, through the API: the dialogs that make
    // them are `apps.spec.ts`'s subject.
    const token = await page.evaluate(async (projectId) => {
      const post = (path: string, body: unknown) =>
        fetch(path, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const copy = { app: "shop", env: "production" };
      const created = await post(`/api/projects/${projectId}/apps`, copy);
      if (!created.ok) throw new Error(`createApp ${created.status}`);
      const minted = await post(`/api/projects/${projectId}/sigils`, copy);
      if (!minted.ok) throw new Error(`createSigil ${minted.status}`);
      return ((await minted.json()) as { token: string }).token;
    }, projectId);

    // ⚠️ Through the isolated `request` fixture, never the page: the page's
    // `fetch` attaches the session bearer, which would replace the sigil's.
    const report = () =>
      request.post(`${baseURL}/sigils/ingest`, {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        data: {
          errors: [
            {
              name: "TypeError",
              message,
              stack: `TypeError: ${message}\n    at checkout (/app/checkout.js:42:10)`,
              sourceUrl: "/api/checkout",
              origin: "server",
              count: 3,
            },
          ],
        },
      });
    expect((await report()).status()).toBe(204);
    let errorUrl = "";

    await test.step("the inbox row opens the error's page", async () => {
      await page.goto(`/${projectSlug}/errors`);
      await expect(page.getByText(message)).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("error-open").first().click();
      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/errors/\\d+$`));
    });

    await test.step("the page shows the error whole", async () => {
      await expect(page.getByTestId("error-name")).toHaveText("TypeError");
      await expect(page.getByTestId("error-message")).toHaveText(message);
      await expect(page.getByTestId("error-count")).toHaveText("3");
      await expect(page.getByTestId("error-stack")).toContainText("checkout");
      await expect(page.getByTestId("error-rail-app")).toContainText(
        "shop/production",
      );
      // A server error reported by an app is trusted on arrival.
      await expect(page.getByTestId("error-rail-trust")).toContainText(
        "Trusted on arrival",
      );
    });

    await test.step("Resolve stays on the page and says so", async () => {
      const url = page.url();
      errorUrl = url;
      await page.getByTestId("error-resolve").click();
      await expect(
        page.getByTestId("error-header").getByTestId("error-status"),
      ).toHaveText("Resolved", { timeout: 10_000 });
      expect(page.url()).toBe(url);
      // Resolved: nothing left to resolve or forward from here.
      await expect(page.getByTestId("error-resolve")).toHaveCount(0);
    });

    await test.step("the inbox no longer lists it as open", async () => {
      await page.getByTestId("error-back").click();
      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/errors$`));
      await expect(page.getByText("No open errors")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("reported again, it stays resolved and says it was seen again", async () => {
      expect((await report()).status()).toBe(204);
      await page.goto(errorUrl);
      const header = page.getByTestId("error-header");
      await expect(header.getByTestId("error-status")).toHaveText("Resolved", {
        timeout: 15_000,
      });
      await expect(header.getByTestId("error-seen-again")).toContainText(
        "Seen again since resolved on",
      );
    });
  });
});
