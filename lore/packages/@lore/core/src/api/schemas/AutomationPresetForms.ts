import { z, type ZType } from "alepha";

import type { AutomationPresetDescriptor } from "./automationPresetDescriptorSchema.ts";

/**
 * The setup form is generated from the same native slot descriptors exposed by
 * the catalogue. It contains local literal fields, never a shared-variable key.
 */
export class AutomationPresetForms {
  public schema(preset: AutomationPresetDescriptor) {
    const fields: Record<string, ZType> = {};
    for (const [key, slot] of Object.entries(preset.slots)) {
      let field: ZType =
        slot.kind === "member" || slot.kind === "folio"
          ? z.uuid()
          : slot.kind === "number" || slot.kind === "release"
            ? z
                .number()
                .min(slot.min ?? 0)
                .max(slot.max ?? Number.MAX_SAFE_INTEGER)
            : slot.kind === "boolean"
              ? z.boolean()
              : slot.kind === "textArray"
                ? z.array(z.string()).max(50)
                : z
                    .string()
                    .min(slot.min ?? (slot.required ? 1 : 0))
                    .max(slot.max ?? 16_384);
      if (slot.values)
        field = field.refine((value) => slot.values!.includes(value as never), {
          message: "Choose an available value",
        });
      if (!slot.required) field = field.optional();
      fields[key] = field;
    }
    return z.object(fields).strict();
  }
  public defaults(preset: AutomationPresetDescriptor) {
    return Object.fromEntries(
      Object.entries(preset.slots)
        .filter(([, slot]) => slot.default !== undefined)
        .map(([key, slot]) => [key, slot.default]),
    );
  }
}
