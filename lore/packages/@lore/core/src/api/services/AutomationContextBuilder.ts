import { $inject } from "alepha";
import { BadRequestError } from "alepha/server";

import type { AutomationCollection } from "../schemas/automationCollectionSchema.ts";
import type { AutomationDescriptor } from "../schemas/automationDescriptorSchema.ts";
import type { AutomationRunSnapshot } from "../schemas/automationRunSnapshotSchema.ts";
import { AutomationTemplateBindings } from "../schemas/AutomationTemplateBindings.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationCollections } from "./AutomationCollections.ts";
import { AutomationProjectSecurity } from "./AutomationProjectSecurity.ts";

/**
 * Explicit source fields only. Even a mistakenly spread resource cannot expose
 * a reporter contact, deployment log or credential through this boundary.
 */
export class AutomationContextBuilder {
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly collections = $inject(AutomationCollections);
  protected readonly security = $inject(AutomationProjectSecurity);
  protected readonly bindings = $inject(AutomationTemplateBindings);

  public async source(
    projectId: number,
    key: string,
    input: Record<string, unknown>,
  ): Promise<AutomationRenderContext> {
    const descriptor = this.catalog
      .entries()
      .find((entry) => entry.key === key && entry.type !== "action");
    if (!descriptor)
      throw new BadRequestError(`Unknown automation source '${key}'`);
    const project = await this.security.projects.getById(projectId);
    const values = this.safe(descriptor.fields, {
      ...input,
      project: project.title,
    });
    return { descriptor, values };
  }

  public async rows(
    projectId: number,
    key: string,
    input: Record<string, unknown>[],
  ): Promise<AutomationRenderContext[]> {
    if (input.length > 50)
      throw new BadRequestError("Selection exceeds 50 rows");
    const descriptor = this.catalog
      .entries()
      .find((entry) => entry.key === key && entry.result === "rows");
    if (!descriptor) throw new BadRequestError("Unknown row selector");
    const project = await this.security.projects.getById(projectId);
    return input.map((row) => ({
      descriptor,
      values: this.safe(descriptor.fields, { ...row, project: project.title }),
    }));
  }

  public async collection(
    projectId: number,
    key: string,
    input: {
      items: Record<string, unknown>[];
      total?: number;
      totalIsExact?: boolean;
      hasMore?: boolean;
      truncated?: boolean;
    },
    values: Record<string, unknown> = {},
  ): Promise<AutomationRenderContext> {
    const context = await this.source(projectId, key, values);
    if (
      context.descriptor.result !== "collection" ||
      !context.descriptor.itemFields
    )
      throw new BadRequestError(
        `Source '${key}' has no collection item contract`,
      );
    const items = input.items
      .slice(0, 50)
      .map((item) => this.safe(context.descriptor.itemFields!, item));
    const hasMore =
      !!input.hasMore ||
      input.items.length > 50 ||
      (input.total !== undefined && input.total > items.length);
    const total =
      input.total ??
      Math.max(input.items.length, items.length + (hasMore ? 1 : 0));
    if (
      !Number.isSafeInteger(total) ||
      total < input.items.length ||
      (hasMore && total <= items.length)
    )
      throw new BadRequestError(
        "Collection total contradicts the observed lower bound",
      );
    const collection: AutomationCollection = {
      items,
      total,
      totalIsExact: input.total !== undefined && input.totalIsExact === true,
      hasMore,
      truncated: !!input.truncated || hasMore,
    };
    context.collection = collection;
    context.values.total = total;
    context.values.total_is_exact = collection.totalIsExact;
    context.values.selected_count = items.length;
    context.values.truncated = collection.truncated;
    let shown = items.length;
    let summary = this.collections.format(
      key,
      collection,
      context.values,
      shown,
    );
    while (new TextEncoder().encode(summary).byteLength > 16_384 && shown > 0) {
      shown -= 1;
      summary = this.collections.format(key, collection, context.values, shown);
    }
    if (new TextEncoder().encode(summary).byteLength > 16_384)
      throw new BadRequestError("Collection summary exceeds 16 KiB");
    collection.truncated ||= shown < items.length;
    context.values.truncated = collection.truncated;
    context.values.summary = summary;
    return context;
  }

  protected safe(
    fields: AutomationDescriptor["fields"],
    input: Record<string, unknown>,
  ): AutomationRunSnapshot["inputs"] {
    const result: AutomationRunSnapshot["inputs"] = {};
    for (const [name, kind] of Object.entries(fields)) {
      if (!Object.hasOwn(input, name)) continue;
      const value = input[name];
      if (value === null) {
        result[name] = null;
        continue;
      }
      try {
        this.bindings.assert(
          { kind, required: true, max: kind === "text" ? 16_384 : undefined },
          value,
          `context.${name}`,
        );
      } catch (error) {
        throw new BadRequestError(
          error instanceof Error ? error.message : "Invalid context value",
        );
      }
      if (Array.isArray(value))
        throw new BadRequestError(
          `context.${name}: collection item arrays are not scalar fields`,
        );
      result[name] =
        name === "url" && typeof value === "string"
          ? this.url(value)
          : (value as string | number | boolean);
    }
    return result;
  }

  protected url(value: string): string {
    if (/[\u0000-\u001f\\]/.test(value))
      throw new BadRequestError("Context URL contains unsafe syntax");
    const relative = value.startsWith("/") && !value.startsWith("//");
    let parsed: URL;
    try {
      parsed = new URL(value, relative ? "https://lore.invalid" : undefined);
    } catch {
      throw new BadRequestError("Context URL is invalid");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new BadRequestError(
        "Context URL must be a safe HTTP resource link",
      );
    parsed.search = "";
    return relative ? `${parsed.pathname}${parsed.hash}` : parsed.toString();
  }
}

export interface AutomationRenderContext {
  descriptor: AutomationDescriptor;
  values: AutomationRunSnapshot["inputs"];
  collection?: AutomationCollection;
}
