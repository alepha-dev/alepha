import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
  signIn,
} from "./_helpers.ts";

/**
 * The dock (#E139, #Q3442): the project rail as an ordered list of pinned
 * projects, stored per account. One spec over the whole of it, against the
 * built server: a new project lands at the end, a drag reorders it and the
 * order survives a reload and a second browser, the right-click menu unpins
 * and pins, a 21st project is created but not pinned, and archiving frees a
 * slot.
 */

const PASSWORD = "DockTest123!";

const rail = (page: Page) => page.getByTestId("project-rail");

/**
 * The pinned icons' titles, top to bottom.
 */
const pins = async (page: Page) =>
  rail(page)
    .getByTestId("project-rail-item")
    .evaluateAll((items) => items.map((it) => it.getAttribute("aria-label")));

const pin = (page: Page, title: string): Locator =>
  rail(page).getByTestId("project-rail-item").and(page.getByLabel(title));

/**
 * A pointer drag dnd-kit recognizes: press, move past its 6 px threshold,
 * travel to the target in steps, release.
 */
const drag = async (page: Page, from: Locator, to: Locator) => {
  // Through the locator first: it waits until the icon really receives the
  // pointer, which a bare `page.mouse` does not (a view transition still
  // covering the page after a navigation hit-tests as `<html>`).
  await from.hover();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, {
    steps: 3,
  });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
};

/**
 * Create a project over the API, which pins it like the wizard does.
 */
const createProject = (page: Page, title: string) =>
  apiPost<{ id: number; slug: string; pinned: boolean }>(
    page,
    "createProject",
    { title },
  );

test.describe("Dock", () => {
  test("a new project lands at the end, and a drag reorders it for every browser", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const t = Date.now();
    const email = `dock-order${t}@example.com`;
    await registerAndVerify(page, email, PASSWORD);

    const alpha = `Alpha${t}`.slice(0, 20);
    const beta = `Beta${t}`.slice(0, 20);
    await createProjectViaWizard(page, alpha);
    const { slug } = await createProjectViaWizard(page, beta);

    // Both pinned, in creation order, the new one at the end.
    await expect.poll(() => pins(page)).toEqual([alpha, beta]);
    // From a settled page: the wizard's landing still navigates once more
    // after it arrives, and that reload would race the drag.
    await page.goto(`/${slug}`);
    await page.waitForLoadState("networkidle");

    // A drag puts Beta on top, and does not open what it dragged.
    const saved = page.waitForResponse(
      (res) =>
        res.url().includes("/users/me/dock") &&
        res.request().method() === "PUT",
    );
    await drag(page, pin(page, beta), pin(page, alpha));
    expect((await saved).ok()).toBe(true);
    await expect.poll(() => pins(page)).toEqual([beta, alpha]);
    expect(new URL(page.url()).pathname).toBe(`/${slug}`);

    // A click is still a click.
    await pin(page, alpha).click();
    await page.waitForURL((url) => url.pathname !== `/${slug}`);

    await page.reload();
    await expect.poll(() => pins(page)).toEqual([beta, alpha]);

    // The order is the account's, not this browser's.
    const other = await browser.newContext({ baseURL });
    const second = await other.newPage();
    expect(await signIn(second, email, PASSWORD)).toBe(true);
    await second.goto(`/${slug}`);
    await expect.poll(() => pins(second)).toEqual([beta, alpha]);
    await other.close();
  });

  test("unpin from the menu, open from All projects into the temporary slot, pin it back", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const t = Date.now();
    await registerAndVerify(page, `dock-menu${t}@example.com`, PASSWORD);

    const keep = `Keep${t}`.slice(0, 20);
    const drop = `Drop${t}`.slice(0, 20);
    await createProjectViaWizard(page, drop);
    await createProjectViaWizard(page, keep);
    await expect.poll(() => pins(page)).toEqual([drop, keep]);

    await pin(page, drop).click({ button: "right" });
    await page.getByTestId("project-rail-menu-unpin").click();
    await expect.poll(() => pins(page)).toEqual([keep]);

    // Opened from All projects, it shows faded below the pins.
    await page.goto("/account/projects");
    await page
      .getByTestId("account-project-row")
      .filter({ hasText: drop })
      .click();
    const slot = rail(page).getByTestId("project-rail-temporary");
    await expect(slot).toHaveAttribute("aria-label", drop);
    await expect(slot).toHaveAttribute("aria-current", "page");

    await slot.click({ button: "right" });
    await page.getByTestId("project-rail-menu-pin").click();
    await expect.poll(() => pins(page)).toEqual([keep, drop]);
    await expect(rail(page).getByTestId("project-rail-temporary")).toHaveCount(
      0,
    );
  });

  test("a 21st project is created but not pinned, and Account > Projects makes room", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const t = Date.now();
    await registerAndVerify(page, `dock-full${t}@example.com`, PASSWORD);
    await page.goto("/");

    const first = await createProject(page, `Full${t} a`.slice(0, 20));
    for (let index = 1; index < 20; index++) {
      const created = await createProject(page, `F${index}x${t}`.slice(0, 20));
      expect(created.pinned).toBe(true);
    }

    const extra = `Extra${t}`.slice(0, 20);
    await createProjectViaWizard(page, extra);
    await expect(page.getByText("Your dock is full")).toBeVisible();
    // Created, open, and in the temporary slot rather than the dock.
    await expect(rail(page).getByTestId("project-rail-item")).toHaveCount(20);
    await expect(
      rail(page).getByTestId("project-rail-temporary"),
    ).toHaveAttribute("aria-label", extra);

    await page.getByRole("button", { name: "Manage pins" }).click();
    await page.waitForURL(/\/account\/projects$/);
    await expect(page.getByTestId("account-projects-pinned-count")).toHaveText(
      "20 / 20 pinned",
    );
    const pinSwitch = (id: number) =>
      page.locator(
        `[data-testid="account-project-pin"][data-project-id="${id}"]`,
      );
    const extraRow = page
      .getByTestId("account-project-row")
      .filter({ hasText: extra });
    const extraHref = await extraRow.getAttribute("href");
    const extraId = await page.evaluate(
      async ({ url }) => {
        const r = await fetch(url, { credentials: "include" });
        return ((await r.json()) as { id: number }).id;
      },
      {
        url: (await apiPath(page, "getProjectBySlug")).replace(
          ":slug",
          extraHref!.slice(1),
        ),
      },
    );
    await expect(pinSwitch(extraId)).toBeDisabled();

    await pinSwitch(first.id).click();
    await expect(page.getByTestId("account-projects-pinned-count")).toHaveText(
      "19 / 20 pinned",
    );
    await pinSwitch(extraId).click();
    await expect(page.getByTestId("account-projects-pinned-count")).toHaveText(
      "20 / 20 pinned",
    );

    await page.goto(extraHref!);
    await expect(pin(page, extra)).toHaveAttribute("aria-current", "page");
    await expect(rail(page).getByTestId("project-rail-temporary")).toHaveCount(
      0,
    );
  });

  test("archiving a pinned project frees its slot", async ({ page }) => {
    test.setTimeout(120_000);
    const t = Date.now();
    await registerAndVerify(page, `dock-archive${t}@example.com`, PASSWORD);

    const stay = `Stay${t}`.slice(0, 20);
    const gone = `Gone${t}`.slice(0, 20);
    const { id: goneId } = await createProjectViaWizard(page, gone);
    const { slug } = await createProjectViaWizard(page, stay);
    await expect.poll(() => pins(page)).toEqual([gone, stay]);

    const archive = (await apiPath(page, "archiveProject")).replace(
      ":id",
      String(goneId),
    );
    await page.evaluate(async (url) => {
      const r = await fetch(url, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    }, archive);

    await page.goto(`/${slug}`);
    await expect.poll(() => pins(page)).toEqual([stay]);
  });
});
