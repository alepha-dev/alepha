import { DialogProvider } from "@alepha/ui";
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

import type { automationCatalogSchema } from "../../../../../../api/schemas/automationCatalogSchema.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import { AutomationOutline } from "../../../../../../api/schemas/AutomationOutline.ts";
import { AutomationVocabulary } from "../../../../../../api/schemas/AutomationVocabulary.ts";
import { projectFixture } from "../../../../../../testing/projectFixture.ts";
import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../../services/I18n.ts";
import AutomationOutlineEditor from "./AutomationOutlineEditor.tsx";

/**
 * The server, in memory: what the editor saved.
 */
class FakeLinkProvider extends LinkProvider {
  public created: Array<{ title: string; rule: AutomationGraphValue }> = [];

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => async (input: any) => {
          if (prop === "createAutomation") {
            this.created.push(input.body);
            return {
              id: "00000000-0000-4000-8000-000000000001",
              projectId: 1,
              title: input.body.title,
              rule: input.body.rule,
              revision: 0,
            };
          }
          return { items: [] };
        },
      },
    );
  }
}

/**
 * The catalogue as the server describes it, everything available.
 */
const catalog = (): ReturnType<typeof automationCatalogSchema.parse> => {
  const entries = new AutomationVocabulary().all();
  return {
    presets: [],
    entries: entries.map((entry) => ({ ...entry, available: true })),
    nodeTypes: [
      {
        type: "schedule",
        kind: "source",
        ports: ["out"],
        fields: {},
        slots: { cron: { kind: "text", required: true, max: 128 } },
        available: true,
      },
      ...entries.map((entry) => ({
        type: entry.key,
        kind: (entry.type === "event"
          ? "source"
          : entry.type === "action"
            ? "action"
            : "read") as "source" | "action" | "read",
        ports: ["out" as const],
        fields: entry.fields,
        slots: entry.slots,
        outputs: entry.outputs,
        available: true,
      })),
    ],
    variables: [],
    variablesHasMore: false,
    channels: [
      { key: "inbox", addressable: true, available: true },
      { key: "email", addressable: true, available: true },
    ],
    limits: {
      selectedRows: 50,
      actions: 5,
      sources: 8,
      nodes: 40,
      actionsPerSource: 5,
      deliveries: 100,
      renderedBytes: 16_384,
      snapshotBytes: 65_536,
      detailDays: 30,
      receiptDays: 90,
    },
  };
};

describe("AutomationOutlineEditor", () => {
  let alepha: Alepha | undefined;
  beforeAll(() => {
    setupJsdomMocks();
  });
  afterEach(async () => {
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
    alepha.store.set(currentProjectAtom, projectFixture({}));
    const saved: unknown[] = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AutomationOutlineEditor
            catalog={catalog()}
            onSaved={(resource) => saved.push(resource)}
            onClose={() => {}}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return { server: alepha.inject(FakeLinkProvider), saved };
  };
  const pick = async (trigger: string, item: string) => {
    fireEvent.click(screen.getByTestId(trigger));
    fireEvent.click(await screen.findByTestId(item));
  };
  const type = (scope: HTMLElement, label: string, value: string) =>
    fireEvent.change(within(scope).getByLabelText(new RegExp(`^${label}`)), {
      target: { value },
    });

  it("goes from empty to a saved graph: an event, a condition and an action on each side", async ({
    expect,
  }) => {
    const { server, saved } = await show();
    expect(
      screen.getByTestId("automation-outline-empty").textContent,
    ).toContain("Choose what starts it");
    expect(screen.queryByRole("alert")).toBeNull();
    await pick(
      "automation-outline-choose",
      "automation-outline-event-epic.completed",
    );
    const block = await screen.findByTestId(
      "automation-outline-block-z-completed",
    );
    fireEvent.click(
      within(block).getByTestId("automation-outline-add-condition-z-completed"),
    );
    const form = await screen.findByTestId("automation-outline-condition-form");
    fireEvent.click(within(form).getByRole("combobox", { name: /Field/ }));
    fireEvent.click(await screen.findByRole("option", { name: "quest_count" }));
    type(form, "Value", "3");

    await pick(
      "automation-outline-add-action-z-completed",
      "automation-outline-action-createQuest",
    );
    let action = await screen.findByTestId("automation-outline-action-form");
    const title = within(action).getByLabelText(
      /^Title/,
    ) as HTMLTextAreaElement;
    fireEvent.focus(title);
    fireEvent.click(
      within(action).getByTestId("automation-outline-placeholder-title"),
    );
    await waitFor(() => expect(title.value).toBe("{{title}}"));
    type(action, "Description", "Look back at the epic");
    type(action, "Area", "ops");

    await pick(
      "automation-outline-add-otherwise-z-completed",
      "automation-outline-action-createQuest",
    );
    action = await screen.findByTestId("automation-outline-action-form");
    type(action, "Title", "Small epic");
    type(action, "Description", "Nothing to review");
    type(action, "Area", "ops");

    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Epic follow-up" },
    });
    const save = screen.getByTestId("automation-outline-save");
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(saved).toHaveLength(1));

    const [created] = server.created;
    expect(created.title).toBe("Epic follow-up");
    const reading = new AutomationOutline().read(created.rule);
    if (!reading.outline) throw new Error(reading.message);
    const [only] = reading.blocks;
    expect(reading.blocks).toHaveLength(1);
    expect(only.events.map((node) => node.type)).toEqual(["epic.completed"]);
    expect(only.condition?.config).toEqual({
      field: "quest_count",
      operator: "eq",
      value: 3,
    });
    expect(only.sequences.map((sequence) => sequence[0].config)).toEqual([
      {
        title: "{{title}}",
        description: "Look back at the epic",
        area: "ops",
      },
    ]);
    expect(only.otherwise.map((sequence) => sequence[0].config.title)).toEqual([
      "Small epic",
    ]);
  });

  it("keeps a schedule alone, and switches an event in the draft", async ({
    expect,
  }) => {
    await show();
    await pick(
      "automation-outline-choose",
      "automation-outline-event-schedule",
    );
    expect(
      (await screen.findByTestId("automation-outline-schedule-alone"))
        .textContent,
    ).toContain("A schedule runs alone");
    expect(screen.queryByTestId("automation-outline-add-block")).toBeNull();
    const toggle = screen.getByTestId("automation-outline-switch-z-schedule");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("false"),
    );
  });
});
