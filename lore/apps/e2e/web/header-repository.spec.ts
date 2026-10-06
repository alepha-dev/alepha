import { expect, test } from "./_fixtures.ts";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * The repository link in the project topbar (feedback #2105).
 *
 * Everything here is conditional on data, which is exactly what a unit render
 * cannot settle: the button reads `currentProjectAtom`, which only the real
 * project route fills, and it picks its icon from the stored URL's host. The
 * three cases that matter are therefore "no URL", "a GitHub URL" and "some
 * other host", and only the first is the common one - most projects have no
 * repository at all, and a dead icon in the topbar is worse than no icon.
 */
const setRepositoryUrl = async (
  page: import("@playwright/test").Page,
  projectId: number,
  repositoryUrl: string | null,
) =>
  page.evaluate(
    async ({ projectId, repositoryUrl }) => {
      const r = await fetch(`/api/updateProjectById/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ repositoryUrl }),
      });
      if (!r.ok) {
        throw new Error(`updateProjectById ${r.status} ${await r.text()}`);
      }
    },
    { projectId, repositoryUrl },
  );

test.describe("the topbar repository link", () => {
  test("appears only with a repositoryUrl, and follows its host", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `repo${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RP${t}`.slice(0, 20),
    );

    // Matched on the destination rather than on a label: the point of the
    // control is where it goes, and the tooltip that says so only exists on
    // hover.
    const link = (host: string) =>
      page.locator(`header a[href*="${host}"], a[href*="${host}"]`).first();

    await test.step("a project with no repository shows nothing", async () => {
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator('a[rel="noreferrer noopener"]')).toHaveCount(0);
    });

    await test.step("a GitHub URL gets a link that opens in a new tab", async () => {
      await setRepositoryUrl(page, projectId, "https://github.com/acme/thing");
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");

      const anchor = link("github.com");
      await expect(anchor).toBeVisible({ timeout: 15_000 });
      await expect(anchor).toHaveAttribute("target", "_blank");
      // `noreferrer` implies `noopener`; both are named because the
      // destination is a URL the project owner typed.
      await expect(anchor).toHaveAttribute("rel", "noreferrer noopener");
      // The accessible name carries the host, which is the part of the
      // destination a reader cannot guess from an icon.
      await expect(anchor).toHaveAttribute("aria-label", /github\.com/);
    });

    await test.step("another host does not get GitHub's mark", async () => {
      await setRepositoryUrl(page, projectId, "https://gitlab.com/acme/thing");
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");

      const anchor = link("gitlab.com");
      await expect(anchor).toBeVisible({ timeout: 15_000 });
      await expect(anchor).toHaveAttribute("aria-label", /gitlab\.com/);

      // `BrandIcon` labels its GitHub mark, so this is the assertion that a
      // GitLab project is not wearing somebody else's logo - the bug the
      // quest calls out as the one only its owner would notice.
      await expect(anchor.locator('[aria-label="GitHub"]')).toHaveCount(0);
    });

    await test.step("clearing the URL takes the link away again", async () => {
      await setRepositoryUrl(page, projectId, null);
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator('a[rel="noreferrer noopener"]')).toHaveCount(0);
    });
  });
});
