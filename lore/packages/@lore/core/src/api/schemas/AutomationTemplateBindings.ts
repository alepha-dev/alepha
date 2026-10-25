import { AlephaError, z } from "alepha";

import type { AutomationSlotKind } from "./automationSlotKindSchema.ts";
import type { AutomationSlot } from "./automationSlotSchema.ts";
import { AutomationTemplateTokens } from "./AutomationTemplateTokens.ts";
import type { AutomationVariableValue } from "./automationVariableValueSchema.ts";

/**
 * Pure binding contract shared by browser authoring, server validation and
 * execution. A missing execution context defers values, never their types.
 */
export class AutomationTemplateBindings {
  protected readonly tokens = new AutomationTemplateTokens();

  public resolve(input: {
    slot: AutomationSlot;
    value: unknown;
    fields: Record<string, AutomationSlotKind>;
    variables: ReadonlyMap<string, AutomationTemplateVariable>;
    context?: Record<string, unknown>;
    path: string;
    literal?: boolean;
  }): { complete: boolean; value?: unknown } {
    const { slot, fields, variables, path } = input;
    if (slot.kind === "textArray" && Array.isArray(input.value)) {
      if (input.value.length > 50)
        throw new AlephaError(`${path}: at most 50 values`);
      const values = input.value.map((value, index) =>
        this.resolve({
          ...input,
          slot: { ...slot, kind: "text", min: undefined, max: undefined },
          value,
          path: `${path}[${index}]`,
        }),
      );
      if (!values.every((value) => value.complete)) return { complete: false };
      const resolved = values.map((value) => value.value);
      this.assert(slot, resolved, path);
      return { complete: true, value: resolved };
    }
    let value = input.value;
    if (!input.literal && typeof value === "string") {
      const names = this.tokens.names(value);
      if (names.length && slot.bindable === false)
        throw new AlephaError(`${path}: use a literal choice`);
      for (const name of names) {
        const variable = variables.get(name);
        if (!Object.hasOwn(fields, name) && !variable)
          throw new AlephaError(`${path}: unknown placeholder '${name}'`);
        if (variable && !variable.available)
          throw new AlephaError(
            `${path}: variable '${name}' is unavailable: ${variable.reason ?? "validation failed"}`,
          );
      }
      const whole = this.tokens.whole(value);
      if (whole) {
        const contextKind = Object.hasOwn(fields, whole)
          ? fields[whole]
          : undefined;
        const kind = contextKind ?? variables.get(whole)?.kind;
        if (kind !== slot.kind && !(slot.kind === "text" && slot.template))
          throw new AlephaError(
            `${path}: placeholder '${whole}' has type '${kind}', expected '${slot.kind}'`,
          );
        if (contextKind && !input.context) return { complete: false };
        value = this.get(whole, fields, variables, input.context, path);
        if (slot.kind === "text" && slot.template) value = String(value);
      } else if (names.length) {
        if (slot.kind !== "text")
          throw new AlephaError(
            `${path}: mixed interpolation yields text, expected '${slot.kind}'`,
          );
        if (!input.context && names.some((name) => Object.hasOwn(fields, name)))
          return { complete: false };
        value = this.tokens.replace(value, (name) =>
          String(this.get(name, fields, variables, input.context, path)),
        );
      }
    }
    this.assert(slot, value, path);
    return { complete: true, value };
  }

  public assert(slot: AutomationSlot, value: unknown, path: string): void {
    const kind = slot.kind;
    const valid =
      kind === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : kind === "release"
          ? typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value > 0
          : kind === "boolean"
            ? typeof value === "boolean"
            : kind === "textArray"
              ? Array.isArray(value) &&
                value.length <= 50 &&
                value.every((item) => typeof item === "string")
              : kind === "member" || kind === "folio"
                ? z.uuid().safeParse(value).success
                : typeof value === "string";
    if (!valid) throw new AlephaError(`${path}: expected '${kind}'`);
    if (
      slot.values &&
      !(Array.isArray(value) ? value : [value]).every((item) =>
        slot.values!.includes(item as never),
      )
    )
      throw new AlephaError(`${path}: unsupported value`);
    const size =
      typeof value === "string" || Array.isArray(value)
        ? value.length
        : typeof value === "number"
          ? value
          : undefined;
    if (
      size !== undefined &&
      ((slot.min !== undefined && size < slot.min) ||
        (slot.max !== undefined && size > slot.max))
    )
      throw new AlephaError(`${path}: outside the allowed bounds`);
  }

  protected get(
    name: string,
    fields: Record<string, AutomationSlotKind>,
    variables: ReadonlyMap<string, AutomationTemplateVariable>,
    context: Record<string, unknown> | undefined,
    path: string,
  ): unknown {
    if (Object.hasOwn(fields, name)) {
      if (
        !context ||
        !Object.hasOwn(context, name) ||
        context[name] === null ||
        context[name] === undefined
      )
        throw new AlephaError(
          `${path}: context value '${name}' is unavailable`,
        );
      this.assert(
        { kind: fields[name], required: true },
        context[name],
        `${path}.${name}`,
      );
      return context[name];
    }
    const variable = variables.get(name);
    if (!variable?.available || !variable.value)
      throw new AlephaError(`${path}: variable '${name}' is unavailable`);
    this.assert(
      { kind: variable.kind, required: true },
      variable.value.value,
      `${path}.${name}`,
    );
    return variable.value.value;
  }
}

export interface AutomationTemplateVariable {
  kind: AutomationVariableValue["kind"];
  available: boolean;
  reason?: string;
  value?: AutomationVariableValue;
}
