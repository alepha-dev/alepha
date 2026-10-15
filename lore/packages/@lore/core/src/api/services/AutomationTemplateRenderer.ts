import { $inject } from "alepha";
import { BadRequestError } from "alepha/server";

import { NotificationHtmlEscaper } from "../notifications/NotificationHtmlEscaper.ts";
import { automationActionSchema } from "../schemas/automationActionSchema.ts";
import type { AutomationRule } from "../schemas/automationRuleSchema.ts";
import type { AutomationRunSnapshot } from "../schemas/automationRunSnapshotSchema.ts";
import { AutomationTemplateBindings } from "../schemas/AutomationTemplateBindings.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationCollections } from "./AutomationCollections.ts";
import type { AutomationRenderContext } from "./AutomationContextBuilder.ts";

/**
 * Binding is one-pass data resolution. Escaping is applied to final delivery
 * output, leaving the stored rule and its custom prose unchanged.
 */
export class AutomationTemplateRenderer {
  public readonly lang = "en" as const;
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly bindings = $inject(AutomationTemplateBindings);
  protected readonly collections = $inject(AutomationCollections);
  protected readonly html = $inject(NotificationHtmlEscaper);

  public render(
    action: AutomationRule["actions"][number],
    context: AutomationRenderContext,
    variables: AutomationRunSnapshot["variables"],
    target: AutomationRenderTarget = "text",
  ): AutomationRenderedAction {
    const descriptor = this.catalog
      .entries()
      .find((entry) => entry.type === "action" && entry.key === action.kind);
    if (!descriptor)
      throw new BadRequestError(`Unknown automation action '${action.kind}'`);
    const reserved = this.catalog.reservedNames();
    for (const variable of variables)
      if (reserved.has(variable.key))
        throw new BadRequestError(
          `Variable '${variable.key}' uses a reserved context name`,
        );
    const bindings = new Map(
      variables.map((variable) => [
        variable.key,
        { kind: variable.value.kind, available: true, value: variable.value },
      ]),
    );
    const values = { ...context.values };
    let shown = context.collection?.items.length ?? 0;
    for (;;) {
      if (context.collection) {
        values.truncated =
          context.collection.truncated ||
          shown < context.collection.items.length;
        values.summary = this.collections.format(
          context.descriptor.key,
          context.collection,
          values,
          shown,
        );
      }
      const raw: Record<string, unknown> = { kind: action.kind };
      const delivery: Record<string, unknown> = { kind: action.kind };
      let bytes = 0;
      let outsideBounds = false;
      for (const key of Object.keys(action))
        if (key !== "kind" && !Object.hasOwn(descriptor.slots, key))
          throw new BadRequestError(`actions.${key}: unknown slot`);
      for (const [name, slot] of Object.entries(descriptor.slots)) {
        const input =
          (action as unknown as Record<string, unknown>)[name] ?? slot.default;
        if (input === undefined && !slot.required) continue;
        let bound: ReturnType<AutomationTemplateBindings["resolve"]>;
        try {
          bound = this.bindings.resolve({
            slot: slot.template ? { ...slot, max: undefined } : slot,
            value: input,
            fields: context.descriptor.fields,
            variables: bindings,
            context: values,
            path: `actions.${name}`,
          });
        } catch (error) {
          throw new BadRequestError(
            error instanceof Error ? error.message : "Invalid template binding",
          );
        }
        raw[name] = bound.value;
        const value =
          slot.template && typeof bound.value === "string"
            ? this.escape(bound.value, target)
            : bound.value;
        delivery[name] = value;
        if (slot.template && slot.max !== undefined)
          outsideBounds ||= [bound.value, value].some(
            (entry) => typeof entry === "string" && entry.length > slot.max!,
          );
      }
      bytes = new TextEncoder().encode(JSON.stringify(delivery)).byteLength;
      if (bytes <= 16_384 && !outsideBounds) {
        const parsedRaw = automationActionSchema.safeParse(raw);
        const parsedDelivery = automationActionSchema.safeParse(delivery);
        if (!parsedRaw.success || !parsedDelivery.success)
          throw new BadRequestError(
            "Rendered action does not match its typed schema",
          );
        if (context.collection && context.collection.items.length === 0)
          return {
            suppressed: true,
            reason: "empty_collection",
            lang: this.lang,
            bytes: 0,
            truncated: false,
            shown: 0,
          };
        return {
          suppressed: false,
          action: parsedDelivery.data,
          raw: parsedRaw.data,
          lang: this.lang,
          bytes,
          truncated:
            !!context.collection &&
            (context.collection.truncated ||
              shown < context.collection.items.length),
          shown,
        };
      }
      if (
        !context.collection ||
        shown === 0 ||
        !Object.values(action).some(
          (value) =>
            typeof value === "string" && /{{\s*summary\s*}}/.test(value),
        )
      )
        throw new BadRequestError("Rendered action exceeds 16 KiB");
      shown -= 1;
    }
  }

  protected escape(value: string, target: AutomationRenderTarget): string {
    if (target === "html") return this.html.escape(value);
    if (target === "markdown")
      return value.replace(/([\\`*_{}[\]()#+\-.!>|])/g, "\\$1");
    if (target === "discord")
      return value
        .replace(/([\\`*_~|>])/g, "\\$1")
        .replace(/@/g, "@\u200b")
        .replace(/</g, "\\<");
    return value;
  }
}

export type AutomationRenderTarget = "text" | "html" | "markdown" | "discord";
export type AutomationRenderedAction =
  | {
      suppressed: true;
      reason: "empty_collection";
      lang: "en";
      bytes: number;
      truncated: boolean;
      shown: number;
    }
  | {
      suppressed: false;
      action: AutomationRule["actions"][number];
      raw: AutomationRule["actions"][number];
      lang: "en";
      bytes: number;
      truncated: boolean;
      shown: number;
    };
