import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
  setProjectFeature,
} from "./_helpers.ts";

/**
 * The questline stat bar's height (feedback #2104).
 *
 * The regression is a MEASUREMENT, not a rendering: the bar looked correct on
 * every small questline anyone tested it against, and cost three lines on
 * `0.29.0`, because its height was a function of how many areas the release
 * happened to touch. So the assertion is that the bar is the same height with
 * one area and with twelve - a property no screenshot of one questline can
 * show, and one that no unit render can either, since it needs real layout.
 *
 * Driven on the EPIC's Flow tab, which is the narrower of the two surfaces
 * that share this bar and therefore the one that decides.
 */
test.describe("the questline stat bar", () => {
  test("is the same height however many areas the questline touches", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const t = Date.now();
    await registerAndVerify(page, `bar${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `SB${t}`.slice(0, 20),
    );
    await setProjectFeature(page, projectId, "epics", true);

    const makeEpic = async (title: string) =>
      page.evaluate(
        async ({ projectId, title }) => {
          const r = await fetch(`/api/createEpic/${projectId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ title }),
          });
          if (!r.ok) throw new Error(`createEpic ${r.status}`);
          return r.json() as Promise<{ id: number; number: number }>;
        },
        { projectId, title },
      );

    const seed = async (epicId: number, title: string, area: string) => {
      const quest = await apiPost<{ id: number }>(page, "createQuest", {
        projectId,
        title,
        description: "Seeded for the stat bar",
        area,
        priority: "medium",
        objectives: [],
        attachments: [],
      });
      await page.evaluate(
        async ({ epicId, questId }) => {
          const r = await fetch(`/api/attachQuest/${epicId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ questId }),
          });
          if (!r.ok) throw new Error(`attachQuest ${r.status}`);
        },
        { epicId, questId: quest.id },
      );
    };

    // One epic with a single area, one with twelve. Twelve rather than
    // seventeen only to keep the seeding cheap: the bar wrapped at four on a
    // narrow panel, so twelve is well past the failure and the assertion is
    // an equality, not a threshold.
    const small = await makeEpic(`Small${t}`);
    await seed(small.id, `S1-${t}`, "orm");
    await seed(small.id, `S2-${t}`, "orm");

    const wide = await makeEpic(`Wide${t}`);
    const areas = [
      "alepha/cli",
      "alepha/core",
      "alepha/orm",
      "alepha/react",
      "alepha/server",
      "alepha/security",
      "alepha/api",
      "lore/ui",
      "lore/quests",
      "lore/folios",
      "lore/sigils",
      "platform",
    ];
    for (const [i, area] of areas.entries()) {
      await seed(wide.id, `W${i}-${t}`, area);
    }

    const barHeight = async (epicNumber: number): Promise<number> => {
      await page.goto(`/${slug}/epics/${epicNumber}?tab=flow`);
      await page.waitForLoadState("domcontentloaded");
      // The zoom readout is inside the bar and is the last thing it renders,
      // so it is the signal that the bar is laid out rather than mounting.
      await expect(page.getByTestId("questline-zoom-level")).toBeVisible({
        timeout: 20_000,
      });
      return page.evaluate(() => {
        const level = document.querySelector(
          "[data-testid=questline-zoom-level]",
        );
        const bar = level?.closest("div.sticky") as HTMLElement | null;
        return bar ? Math.round(bar.getBoundingClientRect().height) : -1;
      });
    };

    const withOneArea = await barHeight(small.number);
    const withTwelve = await barHeight(wide.number);

    expect(withOneArea).toBeGreaterThan(0);
    expect(withTwelve, "the bar must not grow with the number of areas").toBe(
      withOneArea,
    );

    await test.step("the areas are behind a trigger that counts them", async () => {
      // Still on the twelve-area epic.
      const trigger = page.getByRole("button", { name: /12\s*areas/i });
      await expect(trigger).toBeVisible();

      // None of the area names are IN THE BAR until it is opened - that is
      // what makes the height independent of them. Scoped to the bar because
      // the map's own cards carry their area too, so a page-wide assertion
      // would be about the cards and pass or fail for the wrong reason.
      const inBar = await page.evaluate((names: string[]) => {
        const level = document.querySelector(
          "[data-testid=questline-zoom-level]",
        );
        const bar = level?.closest("div.sticky") as HTMLElement | null;
        const text = bar?.textContent ?? "";
        return names.filter((name) => text.includes(name));
      }, areas);
      expect(inBar, "no area name renders in the bar itself").toEqual([]);

      await trigger.click();
      // Every area, with its count, in the popover.
      for (const area of areas) {
        await expect(page.getByText(area, { exact: true }).first()).toBeVisible(
          { timeout: 10_000 },
        );
      }
    });
  });
});
