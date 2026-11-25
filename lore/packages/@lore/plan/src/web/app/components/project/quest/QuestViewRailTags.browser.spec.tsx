import { projectFixture, virtualClientFake } from "@lore/core/testing";
import { currentProjectAtom } from "@lore/core/web";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { afterEach, describe, it } from "vitest";

import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";
import QuestViewRailTags from "./QuestViewRailTags.tsx";

const QUEST = {
  id: 7,
  shortId: 4257,
  title: "Trust server errors",
  tags: ["feat", "security", "needs-human"],
} as unknown as QuestResource;

const world = {
  can: true,
  sent: [] as { id: number; tags?: string[] }[],
  /**
   * Holds the write until the case releases it.
   */
  release: undefined as (() => void) | undefined,
};

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake(
      {
        updateQuestById: (input: {
          params: { id: number };
          body: { tags?: string[] };
        }) => {
          world.sent.push({ id: input.params.id, tags: input.body.tags });
          return new Promise((resolve) => {
            world.release = () => resolve({ ...QUEST, tags: input.body.tags });
          });
        },
      },
      { can: world.can },
    );
  }
}

/**
 * The rail's tags (#Q4285): an "x" over a chip's own text removes it, and
 * only someone who may update the quest gets one.
 */
describe("QuestViewRailTags", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    world.can = true;
    world.sent = [];
    world.release = undefined;
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (updates: QuestResource[] = []) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    alepha.store.set(currentProjectAtom, projectFixture());
    render(
      <AlephaContext.Provider value={alepha}>
        <QuestViewRailTags
          quest={QUEST}
          onUpdate={(quest) => updates.push(quest)}
        />
      </AlephaContext.Provider>,
    );
  };

  it("draws the x inside each chip, absolutely and hidden until hover or focus, so the layout never moves", async ({
    expect,
  }) => {
    await mount();

    const chips = screen.getAllByTestId("quest-rail-tag");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "feat",
      "security",
      "needs-human",
    ]);
    for (const chip of chips) {
      expect(chip.className).toContain("relative");
      const button = chip.querySelector(
        "[data-testid=quest-rail-tag-remove]",
      ) as HTMLElement;
      expect(button.parentElement).toBe(chip);
      const classes = button.className.split(/\s+/);
      expect(classes).toEqual(
        expect.arrayContaining([
          "absolute",
          "inset-0",
          "opacity-0",
          "group-hover/tag:opacity-100",
          "focus-visible:opacity-100",
        ]),
      );
    }
  });

  it("removes the tag through updateQuestById, disabled while it runs, and hands the quest back", async ({
    expect,
  }) => {
    const updates: QuestResource[] = [];
    await mount(updates);

    const remove = screen.getAllByTestId("quest-rail-tag-remove")[1];
    fireEvent.click(remove);

    await waitFor(() =>
      expect(world.sent).toEqual([{ id: 7, tags: ["feat", "needs-human"] }]),
    );
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId("quest-rail-tag-remove")
          .every((it) => it.hasAttribute("disabled")),
      ).toBe(true),
    );
    world.release?.();
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0].tags).toEqual(["feat", "needs-human"]);
  });

  it("offers no x to someone who cannot update the quest", async ({
    expect,
  }) => {
    world.can = false;
    await mount();

    expect(screen.getAllByTestId("quest-rail-tag")).toHaveLength(3);
    expect(screen.queryAllByTestId("quest-rail-tag-remove")).toHaveLength(0);
  });
});
