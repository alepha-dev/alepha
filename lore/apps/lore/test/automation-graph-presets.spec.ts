import { AutomationCatalog, AutomationPresetRegistry } from "@lore/core/api";
import { AutomationGraph } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * Every stock preset builds a graph (#Q3805), with the one builder, laid
 * out by `AutomationGraph.layout`, and the validator accepts it.
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

  it("builds every stock preset as a valid, laid-out graph", ({ expect }) => {
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
      const { rule: graph } = registry.build(preset.key, values as never);
      const issues = graphs
        .check(graph, entries)
        .map((issue) => graphs.message(issue));
      expect({ preset: preset.key, issues }).toEqual({
        preset: preset.key,
        issues: [],
      });
      expect(graph.nodes.every((node) => node.position)).toBe(true);
      expect(graph.nodes.filter((node) => node.kind === "source")).toHaveLength(
        1,
      );
    }
  });
});
