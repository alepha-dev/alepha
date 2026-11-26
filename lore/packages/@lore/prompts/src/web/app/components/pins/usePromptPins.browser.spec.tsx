import { DialogProvider } from "@alepha/ui";
import { DataTable } from "@alepha/ui/table";
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
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { usePromptPins } from "./usePromptPins.tsx";

const WORK_EPIC = {
  name: "work-epic",
  builtin: true,
  title: "Work on epic",
  description: "",
  args: [{ name: "epic", type: "epic", accepts: ["ready", "in_progress"] }],
  text: "Work on {{epic.reference}}",
  source: "write",
  enabled: true,
  permission: "quest:update",
  timeoutSeconds: 600,
  on: "manual",
  maxRunsPerHour: 6,
  maxRunsPerDay: 48,
  concurrency: "queue",
  settleSeconds: 0,
  pins: ["epic"],
} as unknown as PromptResource;

class FakeLinks extends LinkProvider {
  /**
   * The project's ready Agent hosts, set per test.
   */
  public static hosts: string[] = ["desktop"];

  /**
   * The run's answer, held until a test releases it.
   */
  public static run: Promise<unknown> = Promise.resolve({ skipped: [] });

  override client(): any {
    const answers: Record<string, () => unknown> = {
      listPrompts: () => ({ items: [WORK_EPIC], pages: [] }),
      listPromptHosts: () => ({ hosts: FakeLinks.hosts, agents: [] }),
      runPrompt: () => FakeLinks.run,
    };
    return new Proxy(
      {},
      {
        get: (_target, name: string) =>
          Object.assign(async () => answers[name]?.() ?? { items: [] }, {
            can: () => true,
          }),
      },
    );
  }
}

interface Row {
  number: number;
  title: string;
}

/**
 * A list's rows, with what is pinned on the Epic view in their menu.
 */
const EpicRows = () => {
  const pins = usePromptPins();
  return (
    <>
      <DataTable<Row>
        data={[{ number: 2, title: "Ready epic" }]}
        columns={{ title: { label: "Title", cell: (row) => row.title } }}
        rowActions={(row) =>
          pins.rowGroup<Row>("epic", {
            type: "epic",
            value: String(row.number),
            status: "ready",
          })
        }
      />
      {pins.dialog}
    </>
  );
};

/**
 * A row's Agent prompts group (#Q4321): one submenu per pinned prompt,
 * labelled with its title, holding a plain Copy and Run.
 */
describe("usePromptPins rowGroup", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
    FakeLinks.hosts = ["desktop"];
    FakeLinks.run = Promise.resolve({ skipped: [] });
  });

  const mount = async () => {
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
          <EpicRows />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  const menuItem = (name: string | RegExp) =>
    waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')].find(
        (it) => {
          const text = (it.textContent ?? "").trim();
          return typeof name === "string" ? text === name : name.test(text);
        },
      );
      if (!found) throw new Error(`no menu item "${name}"`);
      return found as HTMLElement;
    });

  const openSubmenu = async () => {
    await screen.findByText("Ready epic");
    await waitFor(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open row actions" }));
      await menuItem("Agent prompts");
    });
    fireEvent.click(await menuItem("Agent prompts"));
    fireEvent.click(await menuItem("Work on epic"));
    await menuItem("Copy prompt");
  };

  it("offers each pinned prompt as its own submenu under Agent prompts, and its Run opens the run dialog", async ({
    expect,
  }) => {
    await mount();
    await openSubmenu();
    const run = await menuItem("Run job");
    expect(run.hasAttribute("data-disabled")).toBe(false);
    fireEvent.click(run);

    const dialog = await screen.findByTestId("prompt-run-dialog");
    expect(within(dialog).getByTestId("prompt-run-submit").textContent).toBe(
      "Run",
    );
  });

  it("lists Run disabled, with its reason, when no Agent host is ready (#Q4351)", async ({
    expect,
  }) => {
    FakeLinks.hosts = [];
    await mount();
    await openSubmenu();
    const run = await menuItem(/^Run job/);
    expect(run.textContent).toContain("No Agent host ready");
    expect(run.hasAttribute("data-disabled")).toBe(true);
    fireEvent.click(run);
    expect(screen.queryByTestId("prompt-run-dialog")).toBeNull();
  });
  it("spins Run while the run request is pending, and closes the dialog once it answers (#Q4505)", async ({
    expect,
  }) => {
    let answer: (value: unknown) => void = () => {};
    FakeLinks.run = new Promise((resolve) => {
      answer = resolve;
    });
    await mount();
    await openSubmenu();
    fireEvent.click(await menuItem("Run job"));
    const dialog = await screen.findByTestId("prompt-run-dialog");
    const epic = within(dialog).queryAllByRole("combobox")[0];
    if (epic) fireEvent.click(epic);
    fireEvent.click(within(dialog).getByTestId("prompt-run-submit"));

    await waitFor(() =>
      expect(
        within(dialog)
          .getByTestId("prompt-run-submit")
          .getAttribute("aria-busy"),
      ).toBe("true"),
    );
    answer({ jobId: "00000000-0000-4000-8000-000000000009", skipped: [] });
    await waitFor(() =>
      expect(screen.queryByTestId("prompt-run-dialog")).toBeNull(),
    );
  });
});
