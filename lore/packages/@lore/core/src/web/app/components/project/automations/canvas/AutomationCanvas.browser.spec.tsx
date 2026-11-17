import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, beforeEach, describe, it } from "vitest";

import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import { I18n } from "../../../../services/I18n.ts";
// The inner module, imported here at the top: through the lazy wrapper
// its chunk would race the assertions.
import AutomationCanvasInner from "./AutomationCanvasInner.client.tsx";

/**
 * React Flow measures its pane and nodes with `ResizeObserver`, which jsdom
 * lacks: a no-op one lets it render, its nodes unmeasured, which is all
 * these specs read. The mapping itself has its own spec.
 */
class NoResizeObserver {
  public observe() {}
  public unobserve() {}
  public disconnect() {}
}

const graph: AutomationGraphValue = {
  version: 2,
  nodes: [
    {
      id: "offline",
      kind: "source",
      type: "host.offline",
      config: { kind: "bay" },
    },
    {
      id: "nightly",
      kind: "source",
      type: "schedule",
      config: { cron: "0 9 * * *" },
    },
    {
      id: "bay",
      kind: "condition",
      type: "compare",
      config: { field: "kind", operator: "eq", value: "bay" },
    },
    {
      id: "tell",
      kind: "action",
      type: "notify",
      config: {
        recipient: "user-1",
        channels: ["inbox", "chan-1"],
        category: "automations",
        title: "Host",
        text: "{{host}} is down",
      },
    },
    {
      id: "file",
      kind: "action",
      type: "createQuest",
      config: { title: "Look at {{host}}", description: "", area: "ops" },
    },
  ],
  edges: [
    { from: "offline", port: "out", to: "bay" },
    { from: "bay", port: "true", to: "tell" },
    { from: "bay", port: "false", to: "file" },
    { from: "nightly", port: "out", to: "file" },
  ],
};

describe("AutomationCanvas", () => {
  let alepha: Alepha;
  beforeEach(async () => {
    globalThis.ResizeObserver ??=
      NoResizeObserver as unknown as typeof ResizeObserver;
    alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
  });
  afterEach(async () => {
    cleanup();
    await alepha?.stop();
  });

  it("draws every kind with its labels, its sources' states and its action targets", ({
    expect,
  }) => {
    const selected: Array<string | undefined> = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <AutomationCanvasInner
          graph={graph}
          sources={[
            {
              node: "offline",
              type: "host.offline",
              enabled: true,
              health: "broken",
              reason: "Bay is off",
            },
            {
              node: "nightly",
              type: "schedule",
              enabled: false,
              health: "active",
            },
          ]}
          names={{
            members: { "user-1": "Ada" },
            folios: {},
            channels: { "chan-1": "alerts" },
          }}
          onSelect={(node) => selected.push(node)}
        />
      </AlephaContext.Provider>,
    );
    const node = (id: string) => screen.getByTestId(`automation-node-${id}`);
    expect(node("offline").textContent).toContain("Host offline");
    expect(node("offline").textContent).toContain("kind:bay");
    expect(
      screen.getByTestId("automation-node-offline-state").dataset.state,
    ).toBe("broken");
    expect(
      screen.getByTestId("automation-node-nightly-state").dataset.state,
    ).toBe("off");
    expect(node("nightly").textContent).toContain("Daily at 09:00 UTC");
    expect(node("bay").textContent).toContain("kind");
    expect(node("bay").textContent).toContain("equals");
    expect(node("tell").textContent).toContain("Send a notification");
    expect(screen.getByTestId("automation-node-tell-target").textContent).toBe(
      "Ada",
    );
    expect(node("tell").textContent).toContain("Inbox");
    expect(node("tell").textContent).toContain("alerts");
    expect(screen.getByTestId("automation-node-file-target").textContent).toBe(
      "Look at {{host}}",
    );
    expect(screen.queryByTestId("automation-node-tell-outcome")).toBeNull();
    fireEvent.click(node("tell"));
    expect(selected).toEqual(["tell"]);
  });

  it("paints a run: each node's outcome and the port its condition took", ({
    expect,
  }) => {
    render(
      <AlephaContext.Provider value={alepha}>
        <AutomationCanvasInner
          graph={graph}
          outcomes={[
            { node: "offline", outcome: "ran" },
            { node: "bay", outcome: "ran", port: "true" },
            { node: "tell", outcome: "failed" },
            { node: "file", outcome: "skipped" },
          ]}
          onSelect={() => {}}
        />
      </AlephaContext.Provider>,
    );
    const outcome = (id: string) =>
      screen.getByTestId(`automation-node-${id}`).dataset.outcome;
    expect(outcome("offline")).toBe("ran");
    expect(outcome("tell")).toBe("failed");
    expect(outcome("file")).toBe("skipped");
    expect(outcome("nightly")).toBeUndefined();
    expect(screen.getByTestId("automation-node-bay-outcome").textContent).toBe(
      "Ran → If true",
    );
    expect(screen.getByTestId("automation-node-tell-outcome").textContent).toBe(
      "Failed",
    );
  });
});
