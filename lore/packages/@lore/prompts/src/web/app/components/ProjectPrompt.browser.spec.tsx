import { DialogProvider } from "@alepha/ui";
import type { PromptResource } from "@lore/core/schemas";
import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import ProjectPrompt from "./ProjectPrompt.tsx";

const prompt = (over: Partial<PromptResource> = {}): PromptResource =>
  ({
    name: "nightly",
    builtin: false,
    title: "Nightly check",
    description: "Checks the night's errors.",
    args: [{ name: "quest", type: "quest", accepts: ["todo"] }],
    text: "Work on {{quest.reference}} tonight.",
    source: "read",
    enabled: false,
    permission: "quest:update",
    timeoutSeconds: 600,
    on: "daily@3",
    maxRunsPerHour: 4,
    maxRunsPerDay: 20,
    pins: ["quest"],
    ...over,
  }) as PromptResource;

const world: { items: PromptResource[]; hosts: string[] } = {
  items: [],
  hosts: [],
};

class FakeLinks extends LinkProvider {
  override client(): any {
    const answers: Record<string, (input: any) => unknown> = {
      listPrompts: () => ({
        items: world.items,
        pages: [{ key: "quest", label: "Quest view" }],
      }),
      listPromptHosts: () => ({ hosts: world.hosts }),
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

/**
 * A prompt's own page (#Q4326): its words in the main column, its
 * properties in the aside, the row menu's actions in the toolbar, and a
 * not-found state for a name the project has no prompt for.
 */
describe("ProjectPrompt", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
    world.items = [];
    world.hosts = [];
  });

  const show = async (name: string) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, {
      ...projectFixture(),
      slug: "acme",
    } as never);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectPrompt name={name} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByTestId("project-prompt");
  };

  it("shows the words, the properties beside them, and the row menu's actions", async ({
    expect,
  }) => {
    world.items = [prompt()];
    world.hosts = ["desktop"];
    await show("nightly");

    expect((await screen.findByTestId("prompt-page-text")).textContent).toBe(
      "Work on {{quest.reference}} tonight.",
    );
    const aside = screen.getByTestId("prompt-aside").parentElement
      ?.parentElement as HTMLElement;
    expect(screen.getByTestId("prompt-page-title").textContent).toContain(
      "Nightly check",
    );
    expect(screen.getByTestId("prompt-page-trigger").textContent).toBe(
      "daily@3 · off",
    );
    expect(aside.textContent).toContain("Quest view");
    for (const label of [
      "Copy",
      "Run",
      "Jobs",
      "Duplicate",
      "Enable trigger",
      "Edit",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("offers no Run without a ready Agent host, and Source for a built-in", async ({
    expect,
  }) => {
    world.items = [prompt({ builtin: true, on: "manual" })];
    await show("nightly");
    await screen.findByTestId("prompt-page-text");
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
    expect(screen.queryByTestId("prompt-page-switch")).toBeNull();
    expect(screen.getByRole("button", { name: "Source" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("says so for a name the project has no prompt for", async ({ expect }) => {
    world.items = [prompt()];
    await show("missing");
    const page = screen.getByTestId("project-prompt");
    expect(
      await within(page).findByText("No prompt named missing in this project"),
    ).toBeTruthy();
    expect(screen.queryByTestId("prompt-page-text")).toBeNull();
  });
});
