import { AutomationCatalog, AutomationPresetRegistry } from "@lore/core/api";
import { AutomationGraph } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * Every stock preset, read as a v2 graph (#Q3803): the runner walks a v1
 * rule through `AutomationGraph.fromV1` until storage holds graphs, so each
 * preset's rule has to come out as a graph the validator accepts.
 */
describe("Stock presets as graphs", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    });
    bootLore(alepha);
    await alepha.start();
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("turns every stock preset's rule into a valid straight-line graph", ({
    expect,
  }) => {
    const registry = alepha.inject(AutomationPresetRegistry);
    const entries = alepha.inject(AutomationCatalog).entries();
    const graphs = new AutomationGraph();
    const presets = registry.all();
    expect(presets.length).toBeGreaterThan(15);
    for (const preset of presets) {
      const values: Record<string, unknown> = {};
      for (const [name, slot] of Object.entries(preset.slots)) {
        if (slot.default !== undefined || !slot.required) continue;
        values[name] =
          slot.values?.[0] ??
          (slot.kind === "member" || slot.kind === "folio"
            ? crypto.randomUUID()
            : slot.kind === "number" || slot.kind === "release"
              ? 1
              : slot.kind === "boolean"
                ? true
                : slot.kind === "textArray"
                  ? ["inbox"]
                  : slot.kind === "channel"
                    ? "inbox"
                    : "release");
      }
      const { rule } = registry.build(preset.key, values as never);
      const graph = AutomationGraph.fromV1(rule);
      const issues = graphs
        .check(graph, entries)
        .map((issue) => graphs.message(issue));
      expect({ preset: preset.key, issues }).toEqual({
        preset: preset.key,
        issues: [],
      });
      expect(graph.nodes.filter((node) => node.kind === "action")).toHaveLength(
        rule.actions.length,
      );
    }
  });
});
