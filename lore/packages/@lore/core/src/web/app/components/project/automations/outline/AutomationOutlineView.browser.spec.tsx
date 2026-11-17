import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, beforeEach, describe, it } from "vitest";

import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import { I18n } from "../../../../services/I18n.ts";
import AutomationOutlineView from "./AutomationOutlineView.tsx";

const notify = (id: string, text = "{{host}} is down") => ({
  id,
  kind: "action" as const,
  type: "notify",
  config: {
    recipient: "user-1",
    channels: ["inbox"],
    category: "automations",
    title: "Host",
    text,
  },
});

/**
 * One block: an event, a condition, a sequence of two on its true side and
 * one action on its false side.
 */
const guarded: AutomationGraphValue = {
  version: 2,
  nodes: [
    { id: "offline", kind: "source", type: "host.offline", config: {} },
    {
      id: "bay",
      kind: "condition",
      type: "compare",
      config: { field: "kind", operator: "eq", value: "bay" },
    },
    notify("tell"),
    {
      id: "file",
      kind: "action",
      type: "createQuest",
      config: { title: "Look at {{host}}", description: "", area: "ops" },
    },
    {
      id: "tag",
      kind: "action",
      type: "addTag",
      config: { quest: "{{created_quest_id}}", tag: "ops" },
    },
  ],
  edges: [
    { from: "offline", port: "out", to: "bay" },
    { from: "bay", port: "true", to: "file" },
    { from: "file", port: "out", to: "tag" },
    { from: "bay", port: "false", to: "tell" },
  ],
};

describe("AutomationOutlineView", () => {
  let alepha: Alepha;
  beforeEach(async () => {
    alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
  });
  afterEach(async () => {
    cleanup();
    await alepha?.stop();
  });
  const show = (element: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{element}</AlephaContext.Provider>,
    );

  it("reads a block as When, Only if, Then and Otherwise, a row opening to its configuration", ({
    expect,
  }) => {
    show(<AutomationOutlineView graph={guarded} />);
    expect(screen.getByTestId("automation-outline-when").textContent).toContain(
      "Host offline",
    );
    expect(screen.getByTestId("automation-outline-if").textContent).toContain(
      "equals",
    );
    const then = screen.getByTestId("automation-outline-then");
    expect(then.textContent).toContain("Then");
    expect(then.textContent).toContain("Create a quest");
    expect(then.textContent).toContain("Tag the quest");
    expect(
      screen.getByTestId("automation-outline-otherwise").textContent,
    ).toContain("Send a notification");
    expect(document.body.textContent).not.toContain("offline.out");
    expect(screen.queryByTestId("automation-outline-details")).toBeNull();
    fireEvent.click(
      screen
        .getByTestId("automation-outline-row-tell")
        .querySelector("button")!,
    );
    const details = screen.getByTestId("automation-outline-details");
    expect(details.textContent).toContain("is down");
    expect(details.textContent).toContain("Host");
  });

  it("labels Then as Do without a condition, and switches an event at once", ({
    expect,
  }) => {
    const calls: Array<[string, boolean]> = [];
    show(
      <AutomationOutlineView
        graph={{
          version: 2,
          nodes: [
            { id: "offline", kind: "source", type: "host.offline", config: {} },
            notify("tell"),
          ],
          edges: [{ from: "offline", port: "out", to: "tell" }],
        }}
        sources={[
          {
            node: "offline",
            type: "host.offline",
            enabled: true,
            health: "active",
          },
        ]}
        switches={{
          can: () => true,
          busy: false,
          set: (node, enabled) => calls.push([node, enabled]),
        }}
      />,
    );
    expect(screen.getByTestId("automation-outline-then").textContent).toContain(
      "Do",
    );
    fireEvent.click(screen.getByTestId("automation-outline-switch-offline"));
    expect(calls).toEqual([["offline", false]]);
  });

  it("folds several blocks into one line each, and unfolds one on a click", ({
    expect,
  }) => {
    show(
      <AutomationOutlineView
        graph={{
          version: 2,
          nodes: [
            { id: "offline", kind: "source", type: "host.offline", config: {} },
            notify("tell"),
            { id: "online", kind: "source", type: "host.online", config: {} },
            notify("back", "{{host}} is back"),
            notify("back-2", "again"),
          ],
          edges: [
            { from: "offline", port: "out", to: "tell" },
            { from: "online", port: "out", to: "back" },
            { from: "online", port: "out", to: "back-2" },
          ],
        }}
      />,
    );
    const folded = screen.getByTestId("automation-outline-folded-online");
    expect(folded.textContent).toContain("Host back online");
    expect(folded.textContent).toContain("+1 more");
    expect(screen.queryByTestId("automation-outline-when")).toBeNull();
    fireEvent.click(folded.querySelector("button")!);
    expect(screen.getAllByTestId("automation-outline-when")).toHaveLength(1);
    expect(
      screen.getByTestId("automation-outline-folded-offline"),
    ).toBeDefined();
  });

  it("paints a run: one badge per row, the side not taken dimmed", ({
    expect,
  }) => {
    show(
      <AutomationOutlineView
        graph={guarded}
        outcomes={[
          { node: "offline", outcome: "ran" },
          { node: "bay", outcome: "ran", port: "true" },
          { node: "file", outcome: "ran" },
          { node: "tag", outcome: "failed" },
          { node: "tell", outcome: "skipped" },
        ]}
      />,
    );
    const badge = (id: string) =>
      screen.getByTestId(`automation-outline-outcome-${id}`).textContent;
    expect(badge("offline")).toBe("Started this run");
    expect(badge("bay")).toBe("True");
    expect(badge("tag")).toBe("Failed");
    expect(screen.getByTestId("automation-outline-otherwise").dataset.dim).toBe(
      "true",
    );
    expect(
      screen.getByTestId("automation-outline-then").dataset.dim,
    ).toBeUndefined();
  });

  it("keeps both sides lit when a run over several items took both", ({
    expect,
  }) => {
    show(
      <AutomationOutlineView
        graph={guarded}
        outcomes={[
          { node: "bay", row: 0, outcome: "ran", port: "true" },
          { node: "bay", row: 1, outcome: "ran", port: "false" },
        ]}
      />,
    );
    expect(screen.getByTestId("automation-outline-then").dataset.dim).toBe(
      undefined,
    );
    expect(
      screen.getByTestId("automation-outline-otherwise").dataset.dim,
    ).toBeUndefined();
    expect(
      screen.getByTestId("automation-outline-outcome-bay").textContent,
    ).toBe("False, True");
  });

  it("shows a notice with Delete for a graph that is not an outline", ({
    expect,
  }) => {
    let deleted = 0;
    show(
      <AutomationOutlineView
        graph={{
          ...guarded,
          edges: [...guarded.edges, { from: "bay", port: "true", to: "tell" }],
        }}
        onDelete={() => deleted++}
      />,
    );
    const notice = screen.getByTestId("automation-outline-notice");
    expect(notice.textContent).toContain("Built with the previous editor");
    expect(notice.textContent).toContain("An action has one way in");
    expect(screen.queryByTestId("automation-outline")).toBeNull();
    fireEvent.click(screen.getByText("Delete"));
    expect(deleted).toBe(1);
  });
});
