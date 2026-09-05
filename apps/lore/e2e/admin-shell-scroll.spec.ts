import { expect, test } from "./_fixtures.ts";
import { signInAsAdmin } from "./_helpers.ts";

/**
 * The `fill` shell contract, asserted where it is actually breakable.
 *
 * `AppShell` under `fill` promises one thing: the page itself never scrolls,
 * and whatever scrolls does so inside `main`. That promise had a hole for as
 * long as the parameters editor has existed — `main` declared `overflow-hidden`
 * while staying `position: static`, and an overflow declared on a static
 * element does not clip an absolutely positioned descendant whose containing
 * block resolves above it.
 *
 * Base UI supplies exactly such a descendant: every named form control renders
 * a 1×1 hidden `<input>` styled `position: absolute` with no offsets. On
 * `api.realms.default` — the one parameter with a schema big enough to overflow
 * its card — those inputs escaped `main`, resolved against the positioned
 * `SidebarInset`, and each pinned the document open at its own static offset.
 * The document grew to 1991px against a 720px viewport and the shell scrolled
 * 1271px into empty background.
 *
 * The regression is therefore invisible to any assertion about the page's
 * content: it is measured, not looked at. `api.realms.default` is named here
 * rather than any parameter because a small schema does not reach past the
 * fold and cannot reproduce it.
 */
const measure = async (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    window.scrollTo(0, 5000);
    const pageScrolledBy = window.scrollY;
    window.scrollTo(0, 0);

    const main = document.querySelector("main:not([data-slot])");
    const scrollers = Array.from(document.querySelectorAll("*"))
      .filter((el) => {
        const e = el as HTMLElement;
        const style = getComputedStyle(e);
        return (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          e.scrollHeight - e.clientHeight > 1
        );
      })
      .map((el) => ({
        slot: el.getAttribute("data-slot") ?? el.tagName.toLowerCase(),
        insideMain: main ? main.contains(el) : false,
      }));

    return {
      pageScrolledBy,
      overflowBeyondViewport: doc.scrollHeight - doc.clientHeight,
      scrollers,
    };
  });

test.describe("admin shell scrolling", () => {
  test("a parameter big enough to overflow does not scroll the page", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    await page.goto("/admin/parameters?param=api.realms.default");
    await page.waitForLoadState("domcontentloaded");
    // The form is built from the parameter's runtime schema, fetched after the
    // page mounts, so the fields that produce the hidden inputs do not exist
    // on the first frame.
    await expect(
      page.getByRole("button", { name: /save new version/i }),
    ).toBeVisible({
      timeout: 15_000,
    });

    const { pageScrolledBy, overflowBeyondViewport, scrollers } =
      await measure(page);

    expect(pageScrolledBy, "the page must not scroll").toBe(0);
    expect(
      overflowBeyondViewport,
      "no empty band below the shell",
    ).toBeLessThanOrEqual(1);

    // The card content is the one intended scroller, and it is inside `main`.
    expect(scrollers.length).toBeGreaterThan(0);
    for (const scroller of scrollers) {
      expect(scroller.insideMain, `${scroller.slot} scrolls outside main`).toBe(
        true,
      );
    }
  });

  test("a parameter too small to overflow scrolls nothing at all", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    await page.goto("/admin/parameters?param=api.users.registration");
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.getByRole("button", { name: /save new version/i }),
    ).toBeVisible({
      timeout: 15_000,
    });

    const { pageScrolledBy, scrollers } = await measure(page);

    expect(pageScrolledBy).toBe(0);
    expect(scrollers).toEqual([]);
  });
});
