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

  it("merges every non-schedule stock preset into one valid outline, as a bell does", ({
    expect,
  }) => {
    const registry = alepha.inject(AutomationPresetRegistry);
    const entries = alepha.inject(AutomationCatalog).entries();
    const graphs = new AutomationGraph();
    const values = (key: string) => {
      const preset = registry.all().find((item) => item.key === key)!;
      const out: Record<string, unknown> = {};
      for (const [name, slot] of Object.entries(preset.slots)) {
        if (slot.default !== undefined || !slot.required) continue;
        out[name] =
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
      return out;
    };
    const events = registry
      .all()
      .filter(
        (preset) =>
          registry.build(preset.key, values(preset.key) as never).rule.nodes[0]
            .type !== "schedule",
      )
      .slice(0, 4);
    expect(events.length).toBeGreaterThan(1);
    const { rule } = registry.merge(
      events.map((preset) => ({
        key: preset.key,
        values: values(preset.key) as never,
      })),
    );
    expect(
      graphs.check(rule, entries).map((issue) => graphs.message(issue)),
    ).toEqual([]);
  });

  it("sketches every stock preset for its card: kinds, places and wires, no configuration", ({
    expect,
  }) => {
    const registry = alepha.inject(AutomationPresetRegistry);
    for (const preset of registry.all()) {
      const sketch = registry.sketch(preset.key);
      expect(sketch, preset.key).toBeDefined();
      expect(sketch!.nodes.length).toBeGreaterThan(1);
      expect(sketch!.edges.length).toBeGreaterThan(0);
      expect(JSON.stringify(sketch)).not.toContain("config");
      expect(
        sketch!.nodes.filter((node) => node.kind === "source"),
      ).toHaveLength(1);
    }
  });
});
