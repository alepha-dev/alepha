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
  concurrency: "queue",
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
  /**
   * Every project-wide pause sent, by its `paused` value.
   */
  paused: [] as boolean[],
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
      setPromptsPaused: (input: { body: { paused: boolean } }) => {
        world.paused.push(input.body.paused);
        return held(() => ({
          pausedAt: input.body.paused ? "2026-11-25T08:00:00.000Z" : undefined,
        }));
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
    world.paused = [];
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

  it("has no pause button, and a project paused from the CLI resumes from the note under the table (#Q4358)", async ({
    expect,
  }) => {
    world.items = [prompt()];
    world.pausedAt = "2026-11-25T07:00:00.000Z";
    await show();

    expect(
      screen
        .getAllByRole("button")
        .map((it) => it.getAttribute("aria-label"))
        .filter((it) => (it ?? "").endsWith("triggers")),
    ).toEqual([]);
    fireEvent.click(await screen.findByTestId("prompts-resume"));
    await waitFor(() => expect(world.paused).toEqual([false]));
    world.gate?.(true);
    await waitFor(() =>
      expect(screen.queryByTestId("prompts-paused")).toBeNull(),
    );
  });

  it("switches the checked prompts' triggers on in bulk, at once, skipping a manual one (#Q4358)", async ({
    expect,
  }) => {
    world.items = [
      prompt({ name: "hourly", title: "Hourly", on: "hourly", enabled: false }),
      prompt({ name: "daily", title: "Daily", on: "daily@3", enabled: false }),
      prompt({ name: "manual", title: "Manual one" }),
    ];
    await show();
    const check = (title: string) =>
      fireEvent.click(
        within(screen.getByText(title).closest("tr") as HTMLElement).getByRole(
          "checkbox",
        ),
      );
    check("Hourly");
    check("Daily");
    check("Manual one");

    // Offered for the two it fits, and not Disable: none is on.
    const enable = await screen.findByRole("button", {
      name: "Enable trigger 2",
    });
    expect(
      screen.queryByRole("button", { name: /^Disable trigger/ }),
    ).toBeNull();
    fireEvent.click(enable);

    await waitFor(() => expect(world.writes).toHaveLength(2));
    expect(world.writes.map((it) => it.name).sort()).toEqual([
      "daily",
      "hourly",
    ]);
    expect(world.writes.every((it) => it.body.enabled === true)).toBe(true);
    const states = () =>
      screen
        .getAllByTestId("prompt-on")
        .map((it) => it.getAttribute("data-enabled"));
    await waitFor(() => expect(states()).toEqual(["true", "true", null]));
  });

  it("summarises a trigger in its cell, the checks as badges, and shows it whole on hover (#Q4411)", async ({
    expect,
  }) => {
    world.items = [
      prompt({
        name: "triage",
        title: "Triage",
        on: "event:feedback.created,feedback.commented,error.trusted,hourly",
        check: ["feedback", "errors"],
      }),
    ];
    await show();
    const cell = await screen.findByTestId("prompt-on");
    expect(screen.getByTestId("prompt-on-summary").textContent).toBe(
      "feedback.created +2 · hourly",
    );
    expect(
      screen.getAllByTestId("prompt-on-check").map((it) => it.textContent),
    ).toEqual(["feedback", "errors"]);
    expect(cell.textContent).not.toContain("checks");
    expect(cell.getAttribute("data-enabled")).toBe("true");

    fireEvent.mouseEnter(cell);
    fireEvent.pointerEnter(cell);
    fireEvent.focus(cell);
    const full = await screen.findByTestId("prompt-on-full");
    expect(full.textContent).toContain(
      "event:feedback.created,feedback.commented,error.trusted,hourly",
    );
    expect(full.textContent).toContain("checks feedback, errors");
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
    // The trigger's state, as its cell says it (#Q4327: no Enabled column).
    const enabled = () =>
      screen.getByTestId("prompt-on").getAttribute("data-enabled");
    const openRowMenu = async (action: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Open row actions" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: action }));
    };

    it("has no Enabled column: a manual prompt's menu has no switch, and a triggered one's says it is off in its Trigger cell (#Q4327)", async ({
      expect,
    }) => {
      world.items = [
        prompt(),
        prompt({
          name: "nightly",
          title: "Nightly",
          on: "0 3 * * *",
          enabled: false,
        }),
      ];
      await show();
      await screen.findByText("Nightly");
      expect(
        screen.queryByRole("columnheader", { name: "Enabled" }),
      ).toBeNull();
      const cells = screen.getAllByTestId("prompt-on");
      expect(cells[1]?.textContent).toContain("off");
      expect(cells[1]?.className).toContain("text-muted-foreground");
      expect(cells[0]?.textContent).not.toContain("off");

      const [manualMenu] = screen.getAllByRole("button", {
        name: "Open row actions",
      });
      fireEvent.click(manualMenu!);
      await screen.findByRole("menuitem", { name: "Trigger" });
      expect(
        screen.queryByRole("menuitem", { name: "Disable trigger" }),
      ).toBeNull();
      expect(
        screen.queryByRole("menuitem", { name: "Enable trigger" }),
      ).toBeNull();
    });

    it("turns a trigger off from its row menu at once, keeps it off once the server agrees, and never reads the list again", async ({
      expect,
    }) => {
      world.items = [scheduled()];
      await show();
      await screen.findByText("Weekly");
      expect(enabled()).toBe("true");

      await openRowMenu("Disable trigger");
      // Before the server answers.
      await waitFor(() => expect(enabled()).toBe("false"));
      expect(world.writes).toEqual([
        { name: "weekly", body: { enabled: false } },
      ]);

      world.gate?.(true);
      // Let the answer land, then check nothing moved.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(enabled()).toBe("false");
      expect(world.reads).toBe(1);
    });

    it("puts the trigger back on when the server refuses", async ({
      expect,
    }) => {
      world.items = [scheduled()];
      await show();
      await screen.findByText("Weekly");

      await openRowMenu("Disable trigger");
      await waitFor(() => expect(enabled()).toBe("false"));
      world.gate?.(false);
      await waitFor(() => expect(enabled()).toBe("true"));
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

  /**
   * The filter bar (#Q4357): kind, trigger and source on it, trigger state,
   * args and pins one click away, each clear label naming what it clears.
   */
  describe("filters", () => {
    const three = () => [
      prompt({
        name: "work-epic",
        title: "Work on epic",
        builtin: true,
        source: "write",
        on: "event:epic.ready,daily@3",
        args: [{ name: "epic", type: "epic" }],
        pins: ["quest"],
      }),
      prompt({
        name: "review",
        title: "Review quest",
        source: "read",
        args: [{ name: "quest", type: "quest" }],
      }),
      prompt({
        name: "nightly",
        title: "Nightly",
        on: "hourly",
        enabled: false,
      }),
    ];
    const titles = () =>
      screen.queryAllByTestId("prompt-title").map((it) => it.textContent);
    const pick = async (filter: string, option: string) => {
      if (!screen.queryByRole("combobox", { name: filter })) {
        fireEvent.keyDown(screen.getByRole("button", { name: "Add filters" }), {
          key: "ArrowDown",
        });
        const menu = await screen.findByRole("menu");
        fireEvent.click(
          within(menu).getByRole("menuitem", {
            name: new RegExp(`^${filter}`),
          }),
        );
      } else {
        fireEvent.keyDown(screen.getByRole("combobox", { name: filter }), {
          key: "ArrowDown",
        });
      }
      fireEvent.click(await screen.findByRole("option", { name: option }));
    };

    it("puts kind, trigger and source on the bar, each naming what it clears", async ({
      expect,
    }) => {
      world.items = three();
      await show();
      await waitFor(() => expect(titles()).toHaveLength(3));
      const labels = screen
        .getAllByRole("combobox")
        .filter((el) => el.tagName === "BUTTON")
        .map((el) => el.textContent?.trim());
      expect(labels).toEqual(
        expect.arrayContaining(["All kinds", "All triggers", "All sources"]),
      );
      expect(labels).not.toContain("All");
    });

    it("narrows by kind, by trigger and by source", async ({ expect }) => {
      world.items = three();
      await show();
      await waitFor(() => expect(titles()).toHaveLength(3));

      await pick("Kind", "Custom");
      await waitFor(() =>
        expect(titles()).toEqual(["Review quest", "Nightly"]),
      );
      await pick("Trigger", "On a schedule");
      await waitFor(() => expect(titles()).toEqual(["Nightly"]));
      await pick("Source", "Read-only");
      await waitFor(() => expect(titles()).toEqual([]));
    });

    it("draws values as tags and an absence muted, never one run of raw text (#Q4357)", async ({
      expect,
    }) => {
      world.items = three();
      await show();
      await waitFor(() => expect(titles()).toHaveLength(3));
      const row = (title: string) =>
        screen.getByText(title).closest("tr") as HTMLElement;

      const epic = row("Work on epic");
      expect(
        within(epic)
          .getByTestId("prompt-args-cell")
          .querySelector('[data-slot="badge"]')?.textContent,
      ).toBe("Epic");
      expect(
        within(epic)
          .getByTestId("prompt-source-cell")
          .getAttribute("data-slot"),
      ).toBe("badge");
      expect(
        within(epic)
          .getByTestId("prompt-pins-cell")
          .querySelectorAll('[data-slot="badge"]'),
      ).toHaveLength(1);

      const nightly = row("Nightly");
      expect(
        within(nightly).getByTestId("prompt-source-cell").className,
      ).toContain("text-muted-foreground");
      expect(
        within(nightly).getByTestId("prompt-pins-cell").className,
      ).toContain("text-muted-foreground");
    });

    it("narrows by trigger state, by arg and by pins from the add menu", async ({
      expect,
    }) => {
      world.items = three();
      await show();
      await waitFor(() => expect(titles()).toHaveLength(3));

      await pick("Trigger state", "Off");
      await waitFor(() => expect(titles()).toEqual(["Nightly"]));
      fireEvent.click(
        screen.getByRole("button", { name: "Clear value: Trigger state" }),
      );
      await waitFor(() => expect(titles()).toHaveLength(3));

      await pick("Args", "Quest");
      await waitFor(() => expect(titles()).toEqual(["Review quest"]));
      fireEvent.click(
        screen.getByRole("button", { name: "Clear value: Args" }),
      );
      await waitFor(() => expect(titles()).toHaveLength(3));

      await pick("Pinned on", "Pinned");
      await waitFor(() => expect(titles()).toEqual(["Work on epic"]));
    });
  });
});
