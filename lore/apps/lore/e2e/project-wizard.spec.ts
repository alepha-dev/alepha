import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import { apiPath, registerAndVerify } from "./_helpers.ts";

/**
 * The capability set the server actually stored, by slug.
 *
 * Read rather than inferred from the sidebar: the nav is a separate quest, and
 * a wizard case that asserts through it would go red for the nav's reasons.
 */
const capabilitiesOf = async (
  page: Page,
  slug: string,
): Promise<Array<{ key: string; options: Record<string, boolean> }>> => {
  // ⚠️ Through `apiPath`, not a hand-built URL: `getProjectBySlug` declares
  // an explicit `path`, so the name-derived `/api/<action>/<param>` shape
  // most helpers here use 404s for it.
  const path = await apiPath(page, "getProjectBySlug");
  return page.evaluate(
    async (url) => {
      const r = await fetch(url, { cache: "no-store", credentials: "include" });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const body = (await r.json()) as {
        capabilities: Array<{ key: string; options: Record<string, boolean> }>;
      };
      return body.capabilities;
    },
    path.replace(":slug", slug),
  );
};

/**
 * The creation wizard: pick what the project does, then set it up.
 *
 * Two regressions live here, and the second one only became reachable when the
 * step count stopped being a constant.
 *
 * **The stale draft (Lore #103).** `useForm` builds its `FormModel` once,
 * inside `useMemo(..., [])`, so the submit handler closes over the draft from
 * the first render. Toggling anything re-renders the component while the
 * form's stored handler still sees the initial value. The fix is a ref that is
 * always current; the case below proves a toggle survives submit.
 *
 * **The React 19 button (risk 2 of the spec).** The Next-to-Forge button is a
 * ternary, and React reconciles it by reusing the same `<button>` DOM node and
 * flipping `type` between renders. When advancing to the last step in a click
 * handler, the synchronous flush mutates `type` from "button" to "submit"
 * mid-click, and the browser then dispatches a real `submit` on the form -
 * skipping the final step entirely. `key="next"` / `key="submit"` forces an
 * unmount, so the post-click default action sees the original type. ⚠️ A
 * VARIABLE step count is exactly the condition that fires it, which is why the
 * two-step path is exercised here rather than assumed.
 */
test.describe("Project wizard", () => {
  test("picks capabilities, sets them up, and the draft survives submit", async ({
    page,
  }) => {
    const stamp = Date.now();
    await registerAndVerify(page, `wiz-${stamp}@example.com`, "GoodPassw0rd");

    await page.goto("/new-project");
    await page.waitForLoadState("networkidle");

    // Step 1 - the name. There is no icon step any more: Settings ▸ Banner
    // already carries the identical upload, so the wizard asked for something
    // it did not need before asking what the project was for.
    await page
      .locator('input[type="text"]')
      .first()
      .fill(`Wiz${stamp}`.slice(0, 24));
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 2 - what is this project. Work and Knowledge are preselected,
    // Apps and Support are not, which is what they were before this epic.
    const workRow = page
      .getByRole("button", { name: /plan and track work/i })
      .first();
    const apps = page
      .getByRole("button", { name: /deploy and watch apps/i })
      .first();
    await expect(workRow).toHaveAttribute("aria-pressed", "true");
    await expect(apps).toHaveAttribute("aria-pressed", "false");

    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 3 - set it up. Board and Releases start OFF now: a board is a way
    // to look at quests, not a reason to have them, and the same argument
    // applied consistently takes Releases with it.
    const board = page.getByRole("button", { name: /^board/i }).first();
    await expect(board).toHaveAttribute("aria-pressed", "false");
    await board.click();
    await expect(board).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: /create project/i }).click();
    await page.waitForURL(
      (url) =>
        url.pathname !== "/new-project" &&
        url.pathname.split("/").filter(Boolean).length === 1,
      { timeout: 15_000 },
    );
    const projectSlug = new URL(page.url()).pathname.split("/").find(Boolean);
    expect(projectSlug).toBeTruthy();

    // ⚠️ Read back from the SERVER rather than looked for in the sidebar. The
    // sidebar reading capabilities is its own quest; what this case is about
    // is whether the draft survived the submit, and the project's own
    // capability set is the direct answer to that. The nav is asserted end to
    // end by the capability e2e specs.
    const created = await capabilitiesOf(page, projectSlug!);

    expect(created.map((it) => it.key).sort()).toEqual(["knowledge", "work"]);
    const work = created.find((it) => it.key === "work");
    // The toggle above.
    expect(work?.options.board).toBe(true);
    // Left off, and off is what a new project gets: a board is a way to look
    // at quests, not a reason to have them.
    expect(work?.options.releases).toBe(false);
    expect(work?.options.epics).toBe(false);
  });

  test("skips the setup step when nothing has anything to set up", async ({
    page,
  }) => {
    const stamp = Date.now();
    await registerAndVerify(page, `wiz2-${stamp}@example.com`, "GoodPassw0rd");

    await page.goto("/new-project");
    await page.waitForLoadState("networkidle");
    await page
      .locator('input[type="text"]')
      .first()
      .fill(`Kno${stamp}`.slice(0, 24));
    await page.getByRole("button", { name: /^next$/i }).click();

    // Knowledge only: turn Work off. Knowledge's one option is a preference
    // adopted later, so it contributes no wizard section - and with nothing
    // to set up, the wizard is two steps.
    await page.getByRole("button", { name: /plan and track work/i }).click();

    // ⚠️ The button is now the SUBMIT button, on step 2. This is the React 19
    // hazard's exact condition: a variable step count means the ternary flips
    // on a step it did not use to flip on. If the `key` fix ever regresses,
    // the click below fires a submit that skips a step - and the assertion
    // that follows is what catches it, because the project would be created
    // with Work still on.
    await expect(
      page.getByRole("button", { name: /create project/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^next$/i })).toHaveCount(0);

    await page.getByRole("button", { name: /create project/i }).click();
    await page.waitForURL(
      (url) =>
        url.pathname !== "/new-project" &&
        url.pathname.split("/").filter(Boolean).length === 1,
      { timeout: 15_000 },
    );

    const projectSlug = new URL(page.url()).pathname.split("/").find(Boolean);
    const created = await capabilitiesOf(page, projectSlug!);

    // Knowledge alone. If the button hazard had fired, the submit would have
    // gone off a step early with the initial draft, and Work would be here.
    expect(created.map((it) => it.key)).toEqual(["knowledge"]);
  });

  test("refuses to advance with nothing picked", async ({ page }) => {
    const stamp = Date.now();
    await registerAndVerify(page, `wiz3-${stamp}@example.com`, "GoodPassw0rd");

    await page.goto("/new-project");
    await page.waitForLoadState("networkidle");
    await page
      .locator('input[type="text"]')
      .first()
      .fill(`Non${stamp}`.slice(0, 24));
    await page.getByRole("button", { name: /^next$/i }).click();

    await page.getByRole("button", { name: /plan and track work/i }).click();
    await page
      .getByRole("button", { name: /write and keep knowledge/i })
      .click();

    // At least one is required HERE and nowhere else: a wizard is asking a
    // question and "none" is not an answer to it. Settings has no floor -
    // turning everything off there is a legal state, and the test that the
    // modularity is real.
    await expect(
      page.getByRole("button", { name: /create project|^next$/i }),
    ).toBeDisabled();
  });
});
