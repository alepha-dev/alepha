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

    // `projectErrors` rides the Apps capability, not a errors switch of its
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
    await expect(page.getByText(/No errors\./i)).toBeVisible({
      timeout: 10_000,
    });
    // ...and it did NOT spin into "Maximum update depth" → error boundary.
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });
});
