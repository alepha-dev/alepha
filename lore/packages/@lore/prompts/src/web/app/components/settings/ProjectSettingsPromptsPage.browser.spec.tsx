import { DialogProvider } from "@alepha/ui";
import type { PromptResource } from "@lore/core/schemas";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import { I18n, currentProjectAtom } from "@lore/core/web";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import ProjectSettingsPromptsPage from "./ProjectSettingsPromptsPage.tsx";

const prompt = (over: Partial<PromptResource> = {}): PromptResource => ({
  name: "triage",
  builtin: false,
  title: "Triage",
  description: "",
  args: [],
  text: "Triage the inbox",
  source: "none",
  enabled: true,
  permission: "feedback:triage",
  timeoutSeconds: 600,
  on: "manual",
  maxRunsPerHour: 4,
  maxRunsPerDay: 20,
  settleSeconds: 0,
  consecutiveFailures: 0,
  pins: [],
  ...over,
});

/**
 * What the API answers, set by each case, and every write it was sent.
 */
const world = {
  items: [] as PromptResource[],
  pausedAt: undefined as string | undefined,
  hosts: [] as { slug: string }[],
  /**
   * How many times the list was read: a write changes its row in place
   * and never reads the list again (#Q4301).
   */
  reads: 0,
  /**
   * Each write waits on this gate, so a case reads the screen between the
   * click and the server's answer, then opens it: `true` agrees, `false`
   * refuses.
   */
  gate: undefined as ((ok: boolean) => void) | undefined,
  writes: [] as { name: string; body: Record<string, unknown> }[],
};

/**
 * Holds a write until the case opens the gate.
 */
const held = <T,>(answer: () => T): Promise<T> =>
  new Promise((resolve, reject) => {
    world.gate = (ok) =>
      ok ? resolve(answer()) : reject(new Error("refused by the server"));
  });

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      listPrompts: async () => {
        world.reads += 1;
        return {
          items: world.items,
          pausedAt: world.pausedAt,
          pages: [
            { key: "quests", label: "Quest list" },
            { key: "quest", label: "Quest view" },
          ],
        };
      },
      updatePrompt: (input: {
        params: { name: string };
        body: Record<string, unknown>;
      }) => {
        world.writes.push({ name: input.params.name, body: input.body });
        const row = world.items.find((it) => it.name === input.params.name)!;
        return held(() => ({ ...row, ...input.body }));
      },
      deletePrompt: (input: { params: { name: string } }) => {
        world.writes.push({ name: input.params.name, body: {} });
        return held(() => ({ ok: true }));
      },
      listPromptHosts: async () => ({ hosts: world.hosts }),
      listProjectJobs: async () => ({ items: [] }),
    });
  }
}

/**
 * Settings > Prompts, its Prompts tab (#E174).
 */
describe("ProjectSettingsPromptsPage", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    world.items = [];
    world.pausedAt = undefined;
    world.hosts = [];
    world.reads = 0;
    world.gate = undefined;
    world.writes = [];
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
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
          <ProjectSettingsPromptsPage />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findAllByTestId("prompt-title");
  };

  it("draws Pause left of the primary New prompt, and Resume in the same place once paused (#Q4292)", async ({
    expect,
  }) => {
    world.items = [prompt()];
    await show();

    const labels = () =>
      screen
        .getAllByRole("button")
        .map((it) => it.getAttribute("aria-label"))
        .filter((it) => it === "New prompt" || (it ?? "").endsWith("triggers"));
    expect(labels()).toEqual(["Pause all triggers", "New prompt"]);

    cleanup();
    await alepha?.stop();
    world.pausedAt = "2026-11-25T07:00:00.000Z";
    await show();
    await waitFor(() =>
      expect(labels()).toEqual(["Resume triggers", "New prompt"]),
    );
  });

  it("has no guide link under the table, and a separator only between a missing host and a pause (#Q4291)", async ({
    expect,
  }) => {
    world.items = [prompt()];
    world.pausedAt = "2026-11-25T07:00:00.000Z";
    await show();

    expect(screen.queryByText("How prompts work")).toBeNull();
    const paused = await screen.findByTestId("prompts-paused");
    const footer = paused.parentElement as HTMLElement;
    // No Agent host in this project, so both items show, one dot apart.
    expect(screen.getByTestId("prompts-needs-host")).toBeTruthy();
    expect(footer.textContent?.split(" · ")).toHaveLength(2);
    expect(footer.textContent?.trim().startsWith("·")).toBe(false);
    expect(footer.textContent?.trim().endsWith("·")).toBe(false);
  });

  it("shows a pause alone, with no dot, once an Agent host is ready (#Q4291)", async ({
    expect,
  }) => {
    world.items = [prompt()];
    world.pausedAt = "2026-11-25T07:00:00.000Z";
    world.hosts = [{ slug: "desktop" }];
    await show();

    await waitFor(() =>
      expect(screen.queryByTestId("prompts-needs-host")).toBeNull(),
    );
    const footer = screen.getByTestId("prompts-paused")
      .parentElement as HTMLElement;
    expect(footer.textContent).not.toContain("·");
  });

  describe("a write changes its row in place (#Q4301)", () => {
    const scheduled = () =>
      prompt({ name: "weekly", title: "Weekly", on: "0 9 * * 1" });
    const enabledSwitch = () =>
      within(screen.getByTestId("prompt-enabled")).getByRole("switch");
    const openRowMenu = async (action: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Open row actions" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: action }));
    };

    it("turns a trigger off at once, keeps it off once the server agrees, and never reads the list again", async ({
      expect,
    }) => {
      world.items = [scheduled()];
      await show();
      await screen.findByText("Weekly");
      expect(enabledSwitch().getAttribute("aria-checked")).toBe("true");

      fireEvent.click(enabledSwitch());
      // Before the server answers.
      await waitFor(() =>
        expect(enabledSwitch().getAttribute("aria-checked")).toBe("false"),
      );
      expect(world.writes).toEqual([
        { name: "weekly", body: { enabled: false } },
      ]);

      world.gate?.(true);
      // Let the answer land, then check nothing moved.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(enabledSwitch().getAttribute("aria-checked")).toBe("false");
      expect(world.reads).toBe(1);
    });

    it("puts the switch back when the server refuses", async ({ expect }) => {
      world.items = [scheduled()];
      await show();
      await screen.findByText("Weekly");

      fireEvent.click(enabledSwitch());
      await waitFor(() =>
        expect(enabledSwitch().getAttribute("aria-checked")).toBe("false"),
      );
      world.gate?.(false);
      await waitFor(() =>
        expect(enabledSwitch().getAttribute("aria-checked")).toBe("true"),
      );
      expect(world.reads).toBe(1);
    });

    it("draws new pins at once, and the old ones back on a refusal", async ({
      expect,
    }) => {
      world.items = [prompt({ pins: ["quests"] })];
      await show();
      const cell = () => screen.getByTestId("prompt-pins-cell");
      expect(cell().textContent).toBe("Quest list");

      await openRowMenu("Pin");
      const dialog = await screen.findByTestId("prompt-pins");
      const trigger = within(dialog)
        .getAllByRole("combobox")
        .find((el) => el.tagName === "BUTTON")!;
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      fireEvent.click(
        await screen.findByRole("option", { name: "Quest view" }),
      );
      fireEvent.click(within(dialog).getByTestId("prompt-pins-save"));

      await waitFor(() =>
        expect(cell().textContent).toBe("Quest list, Quest view"),
      );
      expect(world.writes).toEqual([
        { name: "triage", body: { pins: ["quests", "quest"] } },
      ]);
      world.gate?.(false);
      await waitFor(() => expect(cell().textContent).toBe("Quest list"));
      expect(world.reads).toBe(1);
    });

    it("takes a deleted row off once confirmed, without reading the list again", async ({
      expect,
    }) => {
      world.items = [prompt(), prompt({ name: "other", title: "Other" })];
      await show();
      await screen.findByText("Other");

      const row = screen.getByText("Other").closest("tr") as HTMLElement;
      fireEvent.click(
        within(row).getByRole("button", { name: "Open row actions" }),
      );
      fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
      fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

      await waitFor(() =>
        expect(world.writes).toEqual([{ name: "other", body: {} }]),
      );
      world.gate?.(true);
      await waitFor(() => expect(screen.queryByText("Other")).toBeNull());
      expect(screen.getByText("Triage")).toBeTruthy();
      expect(world.reads).toBe(1);
    });
  });
});
