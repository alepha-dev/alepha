import { DialogProvider } from "@alepha/ui";
import type { PromptResource } from "@lore/core/schemas";
import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha, AlephaError } from "alepha";
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

const world: {
  items: PromptResource[];
  hosts: string[];
  updates: Array<{ name: string; body: unknown }>;
  refuse: boolean;
} = {
  items: [],
  hosts: [],
  updates: [],
  refuse: false,
};

class FakeLinks extends LinkProvider {
  override client(): any {
    const answers: Record<string, (input: any) => unknown> = {
      listPrompts: () => ({
        items: world.items,
        pages: [{ key: "quest", label: "Quest view" }],
      }),
      listPromptHosts: () => ({ hosts: world.hosts }),
      updatePrompt: (input: any) => {
        world.updates.push({ name: input.params.name, body: input.body });
        if (world.refuse) throw new AlephaError("Refused");
        return world.items.find((it) => it.name === input.params.name);
      },
      listProjectJobs: () => ({
        items: [
          {
            id: "j1",
            kind: "prompt",
            prompt: "nightly",
            status: "succeeded",
            queuedAt: "2026-11-25T10:00:00.000Z",
          },
          {
            id: "j2",
            kind: "prompt",
            prompt: "triage",
            status: "failed",
            queuedAt: "2026-11-25T11:00:00.000Z",
          },
        ],
      }),
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
 * A prompt's own page (#Q4326): its properties in the aside, three tabs
 * (Prompt, Jobs, Settings, #Q4355), Copy, Run and Duplicate in the toolbar,
 * and a not-found state for a name the project has no prompt for.
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
    world.updates = [];
    world.refuse = false;
    // The tab is kept in the address, which outlives a case under jsdom.
    window.history.replaceState({}, "", "/");
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

  it("shows the words, the properties beside them, three tabs, and Copy, Run, Duplicate and Edit only", async ({
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
    for (const label of ["Copy", "Run", "Duplicate", "Edit"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByTestId("prompt-page-edit")).toBeTruthy();
    for (const label of [
      "Jobs",
      "Pin",
      "Trigger",
      "Enable trigger",
      "Disable trigger",
    ]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    expect(
      screen.getAllByRole("radio").map((it) => it.textContent?.trim()),
    ).toEqual(["Prompt", "Jobs", "Settings"]);
  });

  it("lists this prompt's jobs alone on the Jobs tab, with no prompt filter", async ({
    expect,
  }) => {
    world.items = [prompt()];
    await show("nightly");
    fireEvent.click(await screen.findByRole("radio", { name: "Jobs" }));
    await waitFor(() =>
      expect(
        screen.queryAllByTestId("job-prompt").map((it) => it.textContent),
      ).toEqual(["Nightly check"]),
    );
    expect(screen.queryByTestId("prompt-page-text")).toBeNull();
    const filters = screen
      .getAllByRole("combobox")
      .map((it) => it.getAttribute("aria-label"));
    expect(filters).toContain("Status");
    expect(filters).not.toContain("Prompt");
  });

  it("holds pins, the trigger with its switch, and the source select on the Settings tab (#Q4409)", async ({
    expect,
  }) => {
    world.items = [prompt()];
    await show("nightly");
    fireEvent.click(await screen.findByRole("radio", { name: "Settings" }));
    const settings = await screen.findByTestId("prompt-page-settings");
    expect(
      within(settings).getByTestId("prompt-settings-pins").textContent,
    ).toBe("Quest view");
    expect(
      within(settings).getByTestId("prompt-settings-trigger").textContent,
    ).toBe("daily@3");
    expect(
      within(settings).getByRole("switch", { name: "Enable trigger" }),
    ).toBeTruthy();
    for (const label of ["Pin", "Trigger"]) {
      expect(
        within(settings).getByRole("button", { name: label }),
      ).toBeTruthy();
    }
    expect(
      within(settings).getByRole("combobox", { name: "Source" }).textContent,
    ).toContain("Read-only");
    expect(within(settings).queryByText("Words")).toBeNull();
    expect(within(settings).queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("saves the source picked on the Settings tab, with no dialog", async ({
    expect,
  }) => {
    world.items = [prompt({ builtin: true, on: "manual" })];
    await show("nightly");
    fireEvent.click(await screen.findByRole("radio", { name: "Settings" }));
    const settings = await screen.findByTestId("prompt-page-settings");
    const select = within(settings).getByRole("combobox", { name: "Source" });
    fireEvent.click(select);
    if (!screen.queryByRole("option", { name: "Read-write" })) {
      fireEvent.keyDown(select, { key: "ArrowDown" });
    }
    fireEvent.click(await screen.findByRole("option", { name: "Read-write" }));
    await waitFor(() =>
      expect(world.updates).toEqual([
        { name: "nightly", body: { source: "write" } },
      ]),
    );
    expect(screen.queryByTestId("prompt-editor")).toBeNull();
  });

  it("puts the source back when the server refuses it", async ({ expect }) => {
    world.items = [prompt({ builtin: true, on: "manual" })];
    world.refuse = true;
    await show("nightly");
    fireEvent.click(await screen.findByRole("radio", { name: "Settings" }));
    const settings = await screen.findByTestId("prompt-page-settings");
    const select = within(settings).getByRole("combobox", { name: "Source" });
    fireEvent.click(select);
    if (!screen.queryByRole("option", { name: "Read-write" })) {
      fireEvent.keyDown(select, { key: "ArrowDown" });
    }
    fireEvent.click(await screen.findByRole("option", { name: "Read-write" }));
    await waitFor(() => expect(world.updates).toHaveLength(1));
    await waitFor(() =>
      expect(
        within(settings).getByRole("combobox", { name: "Source" }).textContent,
      ).toContain("Read-only"),
    );
  });

  it("offers no Run and no Edit without a ready host and on a built-in, and Source on its Settings tab", async ({
    expect,
  }) => {
    world.items = [prompt({ builtin: true, on: "manual" })];
    await show("nightly");
    await screen.findByTestId("prompt-page-text");
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    fireEvent.click(await screen.findByRole("radio", { name: "Settings" }));
    const settings = await screen.findByTestId("prompt-page-settings");
    expect(within(settings).queryByTestId("prompt-page-switch")).toBeNull();
    expect(
      within(settings).getByRole("combobox", { name: "Source" }),
    ).toBeTruthy();
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
