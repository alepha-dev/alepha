import type { OpenApiDocument, OpenApiOperation } from "alepha/server/swagger";

/**
 * One operation of the document, with where it lives.
 */
export interface SwaggerEntry {
  /**
   * Stable identifier: the `operationId`, else `METHOD path`.
   */
  id: string;
  method: string;
  path: string;
  tag: string;
  operation: OpenApiOperation;
}

/**
 * The operations of one tag, in document order.
 */
export interface SwaggerGroup {
  tag: string;
  entries: SwaggerEntry[];
}

/**
 * What `$secure` and friends declared about an operation, from its
 * `x-alepha-security` extension. `{}` means a signed-in user is enough.
 */
export interface SwaggerSecurity {
  roles?: string[];
  permissions?: string[];
}

/**
 * The Alepha extensions an operation may carry; see the OpenAPI guide.
 */
export interface SwaggerAlephaMetadata {
  action?: { name: string; group: string };
  middlewares?: string[];
  security?: SwaggerSecurity;
  errors?: string[];
  timeout?: number;
}

/**
 * A read-only view of an OpenAPI document, shaped for the explorer.
 *
 * Plain data in, plain data out: it holds no React state, so a spec can
 * build one from a literal document and every component reads the same
 * answers.
 */
export class OpenApiSpec {
  /**
   * The HTTP methods OpenAPI allows under a path, in the order the explorer
   * lists them. Anything else under a path (`parameters`, `summary`, an
   * extension) is not an operation.
   */
  public static readonly METHODS = [
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
    "trace",
  ];

  public readonly document: OpenApiDocument;
  public readonly entries: SwaggerEntry[];

  constructor(document: OpenApiDocument) {
    this.document = document;
    this.entries = this.collect();
  }

  public get title(): string {
    return this.document.info?.title ?? "API";
  }

  public get version(): string | undefined {
    return this.document.info?.version;
  }

  public get description(): string | undefined {
    return this.document.info?.description;
  }

  /**
   * The operations grouped by their first tag, groups in first-seen order,
   * keeping only those matching `query` (see {@link matches}).
   */
  public groups(query = ""): SwaggerGroup[] {
    const groups = new Map<string, SwaggerEntry[]>();
    for (const entry of this.entries) {
      if (!this.matches(entry, query)) {
        continue;
      }
      const list = groups.get(entry.tag) ?? [];
      list.push(entry);
      groups.set(entry.tag, list);
    }
    return [...groups].map(([tag, entries]) => ({ tag, entries }));
  }

  /**
   * Whether an entry matches a free-text query: every whitespace-separated
   * term must appear, case-insensitively, in its method, path, tag, summary,
   * operation id or action name.
   */
  public matches(entry: SwaggerEntry, query: string): boolean {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      return true;
    }
    const meta = this.metadata(entry.operation);
    const haystack = [
      entry.method,
      entry.path,
      entry.tag,
      entry.operation.summary,
      entry.operation.operationId,
      meta.action?.name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }

  public find(id: string | undefined): SwaggerEntry | undefined {
    return id ? this.entries.find((entry) => entry.id === id) : undefined;
  }

  /**
   * Follow a local `$ref` (`#/components/schemas/X`) to its target, at most
   * once per call: the schema viewer resolves lazily, one level at a time, so
   * a recursive schema never loops.
   */
  public resolve(schema: any): any {
    const ref = schema?.$ref;
    if (typeof ref !== "string" || !ref.startsWith("#/")) {
      return schema;
    }
    let target: any = this.document;
    for (const part of ref.slice(2).split("/")) {
      target = target?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    return target ?? schema;
  }

  /**
   * The name a `$ref` points at (`Product` for `#/components/schemas/Product`).
   */
  public refName(schema: any): string | undefined {
    const ref = schema?.$ref;
    return typeof ref === "string" ? ref.split("/").pop() : undefined;
  }

  /**
   * A one-line type for a schema: `string<email>`, `Product` (a `$ref`, or a
   * titled object), `array<Product>`, `"a" | "b"`, `string | null`.
   */
  public typeLabel(schema: any): string {
    if (!schema || typeof schema !== "object") {
      return "any";
    }
    const name = this.refName(schema);
    if (name) {
      return name;
    }
    // A titled schema the generator inlined (array items are not hoisted).
    if (typeof schema.title === "string" && schema.properties) {
      return schema.title;
    }
    if (Array.isArray(schema.enum)) {
      return schema.enum.map((it: unknown) => JSON.stringify(it)).join(" | ");
    }
    if (schema.const !== undefined) {
      return JSON.stringify(schema.const);
    }
    const variants = schema.oneOf ?? schema.anyOf;
    if (Array.isArray(variants)) {
      return variants.map((it: any) => this.typeLabel(it)).join(" | ");
    }
    if (Array.isArray(schema.allOf)) {
      return schema.allOf.map((it: any) => this.typeLabel(it)).join(" & ");
    }
    const types: string[] = Array.isArray(schema.type)
      ? schema.type
      : schema.type
        ? [schema.type]
        : [];
    const label = types
      .map((type) => {
        if (type === "array") {
          return `array<${this.typeLabel(schema.items)}>`;
        }
        if (
          type === "object" &&
          schema.additionalProperties &&
          !schema.properties
        ) {
          return `record<${this.typeLabel(schema.additionalProperties)}>`;
        }
        return schema.format ? `${type}<${schema.format}>` : type;
      })
      .join(" | ");
    const nullable = schema.nullable ? " | null" : "";
    return (label || (schema.properties ? "object" : "any")) + nullable;
  }

  /**
   * Whether the viewer can open a schema further: an object with properties,
   * an array of one, a reference, or a union.
   */
  public isExpandable(schema: any): boolean {
    const target = this.resolve(schema);
    if (!target || typeof target !== "object") {
      return false;
    }
    if (target.properties && Object.keys(target.properties).length) {
      return true;
    }
    if (target.items) {
      return this.isExpandable(target.items);
    }
    return Array.isArray(target.oneOf ?? target.anyOf ?? target.allOf);
  }

  /**
   * The `x-alepha-*` extensions of an operation, typed.
   */
  public metadata(operation: OpenApiOperation): SwaggerAlephaMetadata {
    return {
      action: operation["x-alepha-action"] as SwaggerAlephaMetadata["action"],
      middlewares: operation["x-alepha-middlewares"] as string[] | undefined,
      security: operation["x-alepha-security"] as SwaggerSecurity | undefined,
      errors: operation["x-alepha-errors"] as string[] | undefined,
      timeout: operation["x-alepha-timeout"] as number | undefined,
    };
  }

  /**
   * Whether the operation needs an identity: Alepha's own `x-alepha-security`
   * when present, else a non-empty OpenAPI `security` requirement.
   */
  public isSecured(operation: OpenApiOperation): boolean {
    if (operation["x-alepha-security"] !== undefined) {
      return true;
    }
    return !!operation.security?.some((it) => Object.keys(it).length > 0);
  }

  protected collect(): SwaggerEntry[] {
    const entries: SwaggerEntry[] = [];
    for (const [path, item] of Object.entries(this.document.paths ?? {})) {
      for (const method of OpenApiSpec.METHODS) {
        const operation = (item as Record<string, OpenApiOperation>)?.[method];
        if (!operation || typeof operation !== "object") {
          continue;
        }
        entries.push({
          id: operation.operationId ?? `${method.toUpperCase()} ${path}`,
          method,
          path,
          tag: operation.tags?.[0] ?? "default",
          operation,
        });
      }
    }
    return entries;
  }
}
