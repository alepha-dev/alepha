import { I18n } from "@lore/core/web";
import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { afterEach, describe, it } from "vitest";

import QuestDiscussionEvent from "./QuestDiscussionEvent.tsx";

const ALICE = "11111111-1111-4111-8111-111111111111";

/**
 * Marking a quest draft or ready writes `drafted` / `readied` to its history
 * (#E178). Each reads as its own sentence in the Discussion, never as the
 * generic "updated the quest".
 */
describe("QuestDiscussionEvent", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (action: "drafted" | "readied", lang = "en") => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang(lang);

    return render(
      <AlephaContext.Provider value={alepha}>
        <ul>
          <QuestDiscussionEvent
            entry={{
              kind: "event",
              key: "history-0",
              at: "2026-08-01T11:00:00.000Z",
              by: ALICE,
              action,
            }}
            users={[{ id: ALICE, username: "alice" } as never]}
          />
        </ul>
      </AlephaContext.Provider>,
    );
  };

  it("says a quest was marked as a draft", async ({ expect }) => {
    await mount("drafted");

    expect(await screen.findByText("marked the quest as a draft")).toBeTruthy();
  });

  it("says a quest was marked ready", async ({ expect }) => {
    await mount("readied");

    expect(await screen.findByText("marked the quest ready")).toBeTruthy();
  });

  it("says both in French", async ({ expect }) => {
    await mount("readied", "fr");

    expect(
      await screen.findByText("a marqué la quête comme prête"),
    ).toBeTruthy();
  });
});
