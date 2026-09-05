import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * When the `[[` picker opens (feedback #2112).
 *
 * `wikiLinkCompletion.browser.spec.ts` pins the completion SOURCE, which is
 * the rule itself and is where the edge cases live. What it cannot show is
 * that CodeMirror's autocomplete plugin agrees: the source returning `null`
 * and no popup appearing over the author's text are two different claims,
 * and the reported bug is the second one.
 *
 * Driven on both surfaces the quest names, because "they share a source" is
 * exactly the kind of thing that is true until someone wires a second editor
 * differently. They do share it - one `createWikiLinkCompletion`, reached
 * through one `LoreEditor` - so this is a check rather than a discovery, and
 * a cheap guard on that staying true.
 */
const PICKER = ".cm-tooltip-autocomplete";

test.describe("the wiki-link picker", () => {
  test("waits for # and a character, in both editors", async ({ page }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `wl${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `WL${t}`.slice(0, 20),
    );

    // Something for the picker to actually find, so "no popup" cannot pass
    // merely because there was nothing to suggest.
    await apiPost(page, "create", {
      title: `Findable${t}`,
      content: "",
      projectId,
    });
    const folio = await apiPost<{ shortId: number }>(page, "create", {
      title: `Host${t}`,
      content: "start\n",
      projectId,
    });

    /**
     * Type into a focused CodeMirror and report whether the picker showed.
     *
     * `pressSequentially`-style keystrokes rather than `fill`, because the
     * plugin listens to input events: a value set in one go would never
     * produce the state being tested.
     */
    const pickerAfter = async (text: string): Promise<boolean> => {
      await page.keyboard.type(text, { delay: 30 });
      // The plugin debounces, so a bare `toHaveCount(0)` would pass simply by
      // being early. Give the popup real time to appear before concluding it
      // did not.
      await page.waitForTimeout(600);
      return (await page.locator(PICKER).count()) > 0;
    };

    const clearLine = async () => {
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(200);
    };

    await test.step("in the folio editor", async () => {
      await page.goto(`/${slug}/folios/${folio.shortId}`);
      await page.waitForLoadState("networkidle");

      const toggle = page.locator("[data-mode]").first();
      if ((await toggle.getAttribute("data-mode")) !== "edit") {
        await toggle.click();
      }
      await expect(toggle).toHaveAttribute("data-mode", "edit");

      const content = page.locator(".cm-content");
      await expect(content).toBeVisible({ timeout: 15_000 });
      await content.click();
      await page.keyboard.press("ControlOrMeta+End");

      // The report: a bare `[[` used to open the picker over the first eight
      // suggestions before the author had said what they wanted.
      expect(await pickerAfter("[["), "a bare [[ must not open it").toBe(false);

      // Still shut one character later, because that character is the hash.
      expect(await pickerAfter("#"), "[[# alone must not open it").toBe(false);

      // And open on the next one.
      expect(await pickerAfter("F"), "[[#F must open it").toBe(true);

      // Backspacing back to `[[` closes it again. This is the `validFor`
      // half: the picker is already open here, so the match pattern is not
      // what is being consulted.
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(600);
      await expect(
        page.locator(PICKER),
        "backspacing to [[ must close it",
      ).toHaveCount(0);

      // Title lookup, end to end. This is the objective the quest called the
      // real decision, and it had been dead in the REAL editor long before
      // this change: CodeMirror runs its own fuzzy pass over the text from
      // `from`, which includes the `#`, against the option label only. The
      // source now says `filter: false`, so what it selected is what shows.
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(200);
      expect(await pickerAfter("[[#Find"), "a title query must match").toBe(
        true,
      );
      await expect(page.locator(".cm-completionLabel")).toHaveText([
        `Findable${t}`,
      ]);
    });

    await test.step("in the quest description editor", async () => {
      await page.goto(`/${slug}/quests`);
      await page.waitForLoadState("networkidle");

      await page
        .getByRole("button", { name: /new quest|create quest/i })
        .first()
        .click();

      const content = page.locator(".cm-content").first();
      await expect(content).toBeVisible({ timeout: 15_000 });
      await content.click();
      await clearLine();

      expect(await pickerAfter("[["), "a bare [[ must not open it").toBe(false);
      expect(await pickerAfter("#F"), "[[#F must open it").toBe(true);
    });
  });
});
