import { $inject, AlephaError, type Infer } from "alepha";

import type { automationFilterValueSchema } from "../schemas/automationFilterValueSchema.ts";
import { AutomationGraph } from "../schemas/AutomationGraph.ts";
import {
  automationGraphSchema,
  type AutomationGraphValue,
} from "../schemas/automationGraphSchema.ts";
import {
  automationPresetDescriptorSchema,
  type AutomationPresetDescriptor,
} from "../schemas/automationPresetDescriptorSchema.ts";
import { AutomationTemplateBindings } from "../schemas/AutomationTemplateBindings.ts";
import { AutomationTemplateTokens } from "../schemas/AutomationTemplateTokens.ts";

/**
 * Feature modules register stock programs, each a graph (#Q3805), most of
 * them a line written with `AutomationGraphBuilder`. Setup choices are literal native
 * values, never implicit shared variables or recursively expanded templates.
 */
export class AutomationPresetRegistry {
  protected readonly entries = new Map<
    string,
    {
      descriptor: AutomationPresetDescriptor;
      build: (
        values: AutomationPresetValues,
        bindings: AutomationPresetBindings,
      ) => AutomationGraphValue;
    }
  >();
  protected readonly bindings = $inject(AutomationTemplateBindings);
  protected readonly tokens = $inject(AutomationTemplateTokens);
  public register(
    descriptor: AutomationPresetDescriptor,
    build: (
      values: AutomationPresetValues,
      bindings: AutomationPresetBindings,
    ) => AutomationGraphValue,
  ): void {
    if (this.entries.has(descriptor.key))
      throw new AlephaError(`Preset '${descriptor.key}' is already registered`);
    this.entries.set(descriptor.key, {
      descriptor: automationPresetDescriptorSchema.parse(descriptor),
      build,
    });
  }
  public all(): AutomationPresetDescriptor[] {
    return structuredClone(
      [...this.entries.values()].map((entry) => entry.descriptor),
    );
  }
  public build(
    key: string,
    input: AutomationPresetValues,
    shared: Record<string, string> = {},
  ) {
    const entry = this.entries.get(key);
    if (!entry) throw new AlephaError(`Unknown automation preset '${key}'`);
    for (const name of Object.keys(input))
      if (!Object.hasOwn(entry.descriptor.slots, name))
        throw new AlephaError(`setup.${name}: unknown slot`);
    const sharedTokens: Record<string, string> = {};
    for (const [name, variable] of Object.entries(shared)) {
      if (entry.descriptor.slots[name]?.bindable !== true)
        throw new AlephaError(
          `setup.${name}: this slot does not support shared binding`,
        );
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(variable))
        throw new AlephaError(`setup.${name}: invalid shared variable key`);
      sharedTokens[name] = `{{${variable}}}`;
    }
    const values: AutomationPresetValues = {};
    for (const [name, slot] of Object.entries(entry.descriptor.slots)) {
      const value = Object.hasOwn(input, name) ? input[name] : slot.default;
      if (value === undefined && !slot.required) continue;
      if (
        !Object.hasOwn(shared, name) &&
        typeof value === "string" &&
        this.tokens.names(value).length
      )
        throw new AlephaError(
          `setup.${name}: choose a literal value or an explicit shared binding`,
        );
      this.bindings.assert(slot, value, `setup.${name}`);
      values[name] = value!;
    }
    return {
      descriptor: structuredClone(entry.descriptor),
      rule: automationGraphSchema.parse(entry.build(values, sharedTokens)),
    };
  }

  /**
   * Several presets as one graph (#Q3808): each preset's nodes, their ids
   * prefixed with the preset's key (`host-offline.source`), laid out
   * together. What a bell makes, and what the editor adds from a preset.
   * Values a preset does not take are left out of its own build.
   */
  public merge(
    parts: Array<{
      key: string;
      values: AutomationPresetValues;
      shared?: Record<string, string>;
      prefix?: string;
    }>,
  ) {
    const nodes: AutomationGraphValue["nodes"] = [];
    const edges: AutomationGraphValue["edges"] = [];
    const descriptors: AutomationPresetDescriptor[] = [];
    for (const part of parts) {
      const entry = this.entries.get(part.key);
      if (!entry)
        throw new AlephaError(`Unknown automation preset '${part.key}'`);
      const own = Object.fromEntries(
        Object.entries(part.values).filter(([name]) =>
          Object.hasOwn(entry.descriptor.slots, name),
        ),
      );
      const built = this.build(part.key, own, part.shared);
      const prefix = part.prefix ?? part.key;
      descriptors.push(built.descriptor);
      nodes.push(
        ...built.rule.nodes.map(({ position: _position, ...node }) => ({
          ...node,
          id: `${prefix}.${node.id}`,
        })),
      );
      edges.push(
        ...built.rule.edges.map((edge) => ({
          ...edge,
          from: `${prefix}.${edge.from}`,
          to: `${prefix}.${edge.to}`,
        })),
      );
    }
    return {
      descriptors,
      rule: AutomationGraph.layout(
        automationGraphSchema.parse({ version: 2, nodes, edges }),
      ),
    };
  }
}
export type AutomationPresetValues = Record<
  string,
  Infer<typeof automationFilterValueSchema>
>;

export type AutomationPresetBindings = Readonly<Record<string, string>>;
