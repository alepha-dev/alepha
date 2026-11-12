import { expect, test } from "./_fixtures.ts";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * A browser whose session has gone is sent to the sign-in page by the first
 * API call refused with a 401, carrying where it was.
 *
 * The hook lives in core's boot class since #Q3400, beside the router rather
 * than on it, and only a real browser can prove it fires: it is a
 * `client:request:error` hook that does nothing on the server.
 *
 * The 401 is served by the test. The browser holds its token beyond its
 * cookies, so clearing them ends nothing, and a spec should not wait out a
 * token's lifetime. A page's own loader runs on the server, so the call that
 * meets the 401 has to be one the browser makes itself: opening the quest
 * form reads through `$client`, in one batch. Both shapes are covered: the
 * batch request refused whole, and a 200 batch whose entries are refused
 * (#Q3400 made those report themselves too).
 */
test.describe("an expired session", () => {
  for (const kind of [
    "an entry of the batch",
    "the batch request itself",
  ] as const) {
    test(`sends the reader to sign in when ${kind} is refused with a 401`, async ({
      page,
    }) => {
      test.setTimeout(120_000);

      const t = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      await registerAndVerify(page, `expired${t}@example.com`, "GoodPassw0rd");
      const { slug } = await createProjectViaWizard(
        page,
        `EX${t}`.slice(0, 20),
      );
      await page.goto(`/${slug}/quests`);
      await page.waitForSelector("html[data-alepha-hydrated='true']");

      // Only the form's read is refused, once: a real expired session still
      // reaches the public reads the sign-in page makes, and a fake that
      // refuses those too would stop the redirect it is meant to observe.
      await page.route(
        "**/api/_batch**",
        (route) => {
          if (kind === "an entry of the batch") {
            // A 200 batch whose entries failed: what a server answers when
            // the session is gone mid-batch.
            const actions = new URL(route.request().url()).searchParams
              .get("actions")!
              .split(",");
            return route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify(
                actions.map((action) => ({
                  action,
                  status: 401,
                  name: "UNAUTHORIZED",
                  error: "Unauthorized",
                })),
              ),
            });
          }
          return route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({
              name: "UNAUTHORIZED",
              message: "Unauthorized",
              data: { status: 401 },
            }),
          });
        },
        { times: 1 },
      );

      await page.getByTestId("project-create-menu").click();
      await page.getByRole("menuitem", { name: "New quest" }).click();

      await page.waitForURL((url) => url.pathname === "/auth/login", {
        timeout: 15_000,
      });
      const url = new URL(page.url());
      expect(url.searchParams.get("redirect")).toMatch(new RegExp(`^/${slug}`));
    });
  }
});
