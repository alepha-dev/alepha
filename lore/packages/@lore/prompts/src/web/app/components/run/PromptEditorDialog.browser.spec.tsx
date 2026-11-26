import type { PromptResource } from "@lore/core/schemas";
import { I18n } from "@lore/core/web";
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

import PromptEditorDialog from "./PromptEditorDialog.tsx";

const saved: unknown[] = [];

class FakeLinks extends LinkProvider {
  override client(): any {
    const answers: Record<string, (input: any) => unknown> = {
      createPrompt: (input: any) => {
        saved.push(input.body);
        return { ...input.body, builtin: false } as PromptResource;
      },
      updatePrompt: (input: any) => {
        saved.push(input.body);
        return { ...input.body, builtin: false } as PromptResource;
      },
    };
    return new Proxy(
      {},
      {
        get: (_target, name: string) =>
          Object.assign(async (input: unknown) => answers[name]?.(input), {
            can: () => true,
          }),
      },
    );
  }
}

const prompt = (over: Partial<PromptResource> = {}): PromptResource =>
  ({
    name: "nightly",
    builtin: false,
    title: "Nightly check",
    description: "Checks the night's errors.",
    args: [{ name: "quest", type: "quest", accepts: ["todo"] }],
    text: "Work on {{quest.reference}} tonight.",
    source: "read",
    concurrency: "queue",
    ...over,
  }) as PromptResource;

/**
 * The prompt editor in three tabs (#Q4534): General, Args and Words, inside
 * one form with one Save, every panel mounted, and a refused field's tab
 * brought forward.
 */
describe("PromptEditorDialog", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
    saved.length = 0;
  });

  const show = async (
    mode: "create" | "duplicate" | "edit",
    initial?: PromptResource,
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <PromptEditorDialog
          open
          onOpenChange={() => {}}
          projectId={1}
          mode={mode}
          {...(initial ? { prompt: initial } : {})}
          onSaved={() => {}}
        />
      </AlephaContext.Provider>,
    );
    await screen.findByTestId("prompt-editor");
  };

  const selected = () =>
    ["general", "args", "words"].find(
      (key) =>
        screen
          .getByTestId(`prompt-tab-${key}`)
          .getAttribute("aria-selected") === "true",
    );

  it("splits the fields into General, Args and Words, starting on General", async ({
    expect,
  }) => {
    await show("create");
    expect(
      ["general", "args", "words"].map(
        (key) => screen.getByTestId(`prompt-tab-${key}`).textContent,
      ),
    ).toEqual(["General", "Args", "Words"]);
    expect(selected()).toBe("general");

    fireEvent.click(screen.getByTestId("prompt-tab-words"));
    await waitFor(() => expect(selected()).toBe("words"));
    expect(screen.getByTestId("prompt-legend")).toBeTruthy();
  });

  it("saves the fields of every tab with the one Save, in edit and duplicate", async ({
    expect,
  }) => {
    for (const mode of ["edit", "duplicate"] as const) {
      await show(mode, prompt());
      fireEvent.click(screen.getByTestId("prompt-save"));
      await waitFor(() => expect(saved).toHaveLength(1));
      expect(saved[0]).toMatchObject({
        title: "Nightly check",
        text: "Work on {{quest.reference}} tonight.",
        args: [{ name: "quest", type: "quest", accepts: ["todo"] }],
      });
      cleanup();
      await alepha?.stop();
      saved.length = 0;
    }
  });

  it("brings forward the tab of a field refused on submit", async ({
    expect,
  }) => {
    await show(
      "edit",
      prompt({ args: [{ name: "x".repeat(40), type: "quest" }] }),
    );
    expect(selected()).toBe("general");
    fireEvent.click(screen.getByTestId("prompt-save"));
    await waitFor(() => expect(selected()).toBe("args"));
    expect(saved).toHaveLength(0);
  });
});
