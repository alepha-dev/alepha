import { $inject, AlephaError, type Infer } from "alepha";

import type { automationFilterValueSchema } from "../schemas/automationFilterValueSchema.ts";
import {
  automationPresetDescriptorSchema,
  type AutomationPresetDescriptor,
} from "../schemas/automationPresetDescriptorSchema.ts";
import {
  automationRuleSchema,
  type AutomationRule,
} from "../schemas/automationRuleSchema.ts";
import { AutomationTemplateBindings } from "../schemas/AutomationTemplateBindings.ts";
import { AutomationTemplateTokens } from "../schemas/AutomationTemplateTokens.ts";

/**
 * Feature modules register stock programs. Setup choices are literal native
 * values, never implicit shared variables or recursively expanded templates.
 */
export class AutomationPresetRegistry {
  protected readonly entries = new Map<
    string,
    {
      descriptor: AutomationPresetDescriptor;
      build: (values: AutomationPresetValues) => AutomationRule;
    }
  >();
  protected readonly bindings = $inject(AutomationTemplateBindings);
  protected readonly tokens = $inject(AutomationTemplateTokens);
  public register(
    descriptor: AutomationPresetDescriptor,
    build: (values: AutomationPresetValues) => AutomationRule,
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
  public build(key: string, input: AutomationPresetValues) {
    const entry = this.entries.get(key);
    if (!entry) throw new AlephaError(`Unknown automation preset '${key}'`);
    for (const name of Object.keys(input))
      if (!Object.hasOwn(entry.descriptor.slots, name))
        throw new AlephaError(`setup.${name}: unknown slot`);
    const values: AutomationPresetValues = {};
    for (const [name, slot] of Object.entries(entry.descriptor.slots)) {
      const value = Object.hasOwn(input, name) ? input[name] : slot.default;
      if (value === undefined && !slot.required) continue;
      if (typeof value === "string" && this.tokens.names(value).length)
        throw new AlephaError(
          `setup.${name}: choose a literal value; use the editor for shared bindings`,
        );
      this.bindings.assert(slot, value, `setup.${name}`);
      values[name] = value!;
    }
    return {
      descriptor: structuredClone(entry.descriptor),
      rule: automationRuleSchema.parse(entry.build(values)),
    };
  }
}
export type AutomationPresetValues = Record<
  string,
  Infer<typeof automationFilterValueSchema>
>;
