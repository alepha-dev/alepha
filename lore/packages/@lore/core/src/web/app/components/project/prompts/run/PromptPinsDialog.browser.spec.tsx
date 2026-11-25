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
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { virtualClientFake } from "../../../../../../testing/virtualClientFake.ts";
import { I18n } from "../../../../services/I18n.ts";
import PromptPinsDialog from "./PromptPinsDialog.tsx";

const PAGES = [
  { key: "quests", label: "Quest list" },
  { key: "quest", label: "Quest view" },
  { key: "epics", label: "Epic list" },
  { key: "epic", label: "Epic view" },
];

const sent: { pins?: string[] }[] = [];

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      updatePrompt: async (input: { body: { pins?: string[] } }) => {
        sent.push(input.body);
        return {};
      },
    });
  }
}

/**
 * The Pin dialog (#Q4300): one multi select over the pinnable pages, where
 * it was a column of switches.
 */
describe("PromptPinsDialog", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;
  const closed: boolean[] = [];

  afterEach(async () => {
    sent.length = 0;
    closed.length = 0;
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (pins: string[]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <PromptPinsDialog
          open
          onOpenChange={(next) => closed.push(next)}
          projectId={1}
          prompt={{ name: "work-quest", title: "Work quest", pins } as never}
          pages={PAGES}
          invalidates={["project-prompts", 1]}
        />
      </AlephaContext.Provider>,
    );
    await screen.findByTestId("prompt-pins");
  };

  const trigger = () =>
    screen.getAllByRole("combobox").find((el) => el.tagName === "BUTTON")!;
  const toggle = async (name: string) => {
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name }));
  };

  it("draws one select, not a switch per page, starting on the prompt's pins", async ({
    expect,
  }) => {
    await show(["quest", "epic"]);

    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(trigger().textContent).toContain("Quest view");
    expect(trigger().textContent).toContain("Epic view");
  });

  it("saves the picked pages as pins, in the server's order", async ({
    expect,
  }) => {
    await show(["epic"]);

    await toggle("Quest list");
    fireEvent.click(screen.getByTestId("prompt-pins-save"));

    await waitFor(() => expect(sent).toEqual([{ pins: ["quests", "epic"] }]));
    expect(closed).toEqual([false]);
  });

  it("unpins everywhere when nothing is left selected", async ({ expect }) => {
    await show(["quest"]);

    await toggle("Quest view");
    fireEvent.click(screen.getByTestId("prompt-pins-save"));

    await waitFor(() => expect(sent).toEqual([{ pins: [] }]));
  });
});
