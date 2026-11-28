import { projectFixture } from "@lore/core/testing";
import { ElementReferenceRegistry, I18n } from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, it } from "vitest";

import QuestCreate from "./QuestCreate.tsx";

/**
 * Stands in for the HTTP-backed `useClient()`, the substitution seam
 * `QuestDependencyPicker.browser.spec.tsx` uses. Every action the form reads
 * on mount answers empty, and every permission check answers yes, so both
 * halves of the split button render enabled.
 */
class FakeLinkProvider extends LinkProvider {
  /**
   * Every `createQuest` body, so a spec reads what the form sent.
   */
  static created: Array<Record<string, unknown>> = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    const action = (result: unknown) =>
      Object.assign(async () => result, { can: () => true });

    return {
      createQuest: Object.assign(
        async (req: { body: Record<string, unknown> }) => {
          FakeLinkProvider.created.push(req.body);
          return { id: 1, shortId: 1, area: req.body.area };
        },
        { can: () => true },
      ),
      acceptQuest: action({}),
      updateQuestById: action({}),
      listQuestTags: action([]),
      getQuests: action({ content: [] }),
      getAreas: action([]),
    };
  }
}

/**
 * The create button is a split button: "Create quest", and a chevron opening
 * a menu of "Create and accept" and, on a loose quest, "Create as draft".
 *
 * The chevron used to carry the menu item's own label. It read as a button
 * that creates and accepts, while a click on it only opens the menu: a screen
 * reader announced an action that did not happen, and a click by name landed
 * on the wrong control.
 */
describe("QuestCreate", () => {
  let alepha: Alepha | undefined;

  // The Priority and Size pickers measure their thumb with a ResizeObserver,
  // which jsdom does not ship.
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    FakeLinkProvider.created = [];
  });

  const mount = async (
    extra: Partial<Parameters<typeof QuestCreate>[0]> = {},
  ) => {
    // The substitution comes first: the router module resolves `LinkProvider`,
    // and a substitution after it is refused as too late.
    alepha = Alepha.create()
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    // The description editor reads it, and the container locks at start.
    alepha.inject(ElementReferenceRegistry);
    await alepha.start();

    return render(
      <AlephaContext.Provider value={alepha}>
        <QuestCreate
          project={projectFixture()}
          onSubmit={() => {}}
          onCreated={() => {}}
          {...extra}
        />
      </AlephaContext.Provider>,
    );
  };

  it("names the chevron after what it does, opening more options", async ({
    expect,
  }) => {
    await mount();

    const chevron = await screen.findByRole("button", {
      name: "More create options",
    });
    expect(chevron.getAttribute("type")).toBe("button");
  });

  it("leaves 'Create and accept' to the menu item alone", async ({
    expect,
  }) => {
    await mount();

    await screen.findByRole("button", { name: "Create quest" });
    expect(screen.queryByRole("button", { name: "Create and accept" })).toBe(
      null,
    );
  });

  /**
   * "Create as draft" (#E178) is a loose quest's: a quest filed into an
   * epic as it is created takes its draft from the epic, and the server
   * refuses `draft: true` under a ready one.
   */
  const menuItems = async () => {
    fireEvent.click(
      await screen.findByRole("button", { name: "More create options" }),
    );
    await screen.findAllByRole("menuitem");
    return screen.getAllByRole("menuitem").map((it) => it.textContent);
  };

  it("offers 'Create as draft' on a loose quest", async ({ expect }) => {
    await mount();

    expect(await menuItems()).toEqual(["Create and accept", "Create as draft"]);
  });

  it("does not offer 'Create as draft' when the quest is filed into an epic", async ({
    expect,
  }) => {
    await mount({ intoEpic: true });

    expect(await menuItems()).toEqual(["Create and accept"]);
  });

  it("sends draft: true from 'Create as draft', and nothing from 'Create quest'", async ({
    expect,
  }) => {
    await mount({ quest: { title: "Sketch", area: "lore" } });

    await menuItems();
    fireEvent.click(screen.getByRole("menuitem", { name: "Create as draft" }));
    await waitFor(() => expect(FakeLinkProvider.created).toHaveLength(1));
    expect(FakeLinkProvider.created[0]?.draft).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Create quest" }));
    await waitFor(() => expect(FakeLinkProvider.created).toHaveLength(2));
    expect(FakeLinkProvider.created[1]).not.toHaveProperty("draft");
  });
});
