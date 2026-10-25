import { z, type ZType } from "alepha";

import { automationFilterValueSchema } from "./automationFilterValueSchema.ts";
import type { AutomationPresetDescriptor } from "./automationPresetDescriptorSchema.ts";
import { automationVariableResourceSchema } from "./automationVariableResourceSchema.ts";

/**
 * Native setup and explicit sharing controls use the catalogue slot types.
 * Literal defaults never introduce a shared key. Selected identities and
 * conditional validation remain separate from the ordinary form schema.
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
  public authoringSchema(preset: AutomationPresetDescriptor) {
    const native = this.schema(preset);
    const fields: Record<string, ZType> = {};
    for (const [name, field] of Object.entries(native.shape))
      fields[name] = field.optional();
    for (const [name, slot] of Object.entries(preset.slots)) {
      if (!slot.bindable) continue;
      fields[`mode_${name}`] = z
        .enum(["literal", "shared", "create"])
        .default("literal");
      fields[`shared_${name}`] = z.string().optional();
      fields[`key_${name}`] = z.string().max(64).optional();
      fields[`local_${name}`] = automationFilterValueSchema.optional();
      fields[`binding_${name}`] = automationVariableResourceSchema.optional();
    }
    return z.object(fields).strict();
  }

  public validateAuthoring(
    preset: AutomationPresetDescriptor,
    values: Record<string, unknown>,
    messages: {
      invalidValue: string;
      sharedRequired: string;
      keyRequired: string;
    },
  ): { path: string; message: string } | undefined {
    const native = this.schema(preset);
    for (const [name, slot] of Object.entries(preset.slots)) {
      const mode = slot.bindable ? values[`mode_${name}`] : "literal";
      if (mode === "shared") {
        const binding = automationVariableResourceSchema.safeParse(
          values[`binding_${name}`],
        );
        if (
          !binding.success ||
          !binding.data.available ||
          !binding.data.value ||
          binding.data.id !== values[`shared_${name}`] ||
          binding.data.kind !== slot.kind ||
          !native.shape[name].safeParse(binding.data.value.value).success
        )
          return { path: `/shared_${name}`, message: messages.sharedRequired };
      } else {
        if (!native.shape[name].safeParse(values[name]).success)
          return { path: `/${name}`, message: messages.invalidValue };
        const key = values[`key_${name}`];
        if (
          mode === "create" &&
          (typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))
        )
          return { path: `/key_${name}`, message: messages.keyRequired };
      }
    }
    return undefined;
  }

  public defaults(preset: AutomationPresetDescriptor) {
    return Object.fromEntries(
      Object.entries(preset.slots)
        .filter(([, slot]) => slot.default !== undefined)
        .map(([key, slot]) => [key, slot.default]),
    );
  }
}
