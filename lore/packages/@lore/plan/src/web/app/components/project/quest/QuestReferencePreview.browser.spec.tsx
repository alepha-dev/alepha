import { virtualClientFake } from "@lore/core/testing";
import { I18n } from "@lore/core/web";
import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { afterEach, describe, it } from "vitest";

import QuestReferencePreview from "./QuestReferencePreview.tsx";

const world = { reads: 0 };

class FakeLinks extends LinkProvider {
  override client(): any {
    return virtualClientFake({
      getQuestByShortId: async () => {
        world.reads += 1;
        return {
          shortId: 12,
          title: "Fix the cart",
          area: "shop",
          priority: "high",
          metadata: {
            status: "in_progress",
            objectivesProgress: { completed: 1, waived: 0, total: 2 },
          },
        };
      },
    });
  }
}

/**
 * A quest's hover card (#Q4349): its status and priority as the UI says
 * them, its area and the objectives done, read once and cached.
 */
describe("QuestReferencePreview", () => {
  afterEach(() => {
    cleanup();
    world.reads = 0;
  });

  it("shows status, priority, area and objectives, and reads the quest once for two cards", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: FakeLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const card = () => (
      <AlephaContext.Provider value={alepha}>
        <QuestReferencePreview projectId={1} id="12" />
      </AlephaContext.Provider>
    );

    const first = render(card());
    expect((await screen.findByTestId("quest-preview-facts")).textContent).toBe(
      "In progress · High · shop · 1/2 objectives",
    );
    first.unmount();
    render(card());
    await screen.findByTestId("quest-preview-facts");
    expect(world.reads).toBe(1);
    await alepha.stop();
  });
});
