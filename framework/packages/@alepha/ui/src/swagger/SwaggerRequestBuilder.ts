import { jsonSchemaToZod, type ZObject, type ZType, z } from "alepha";

import type { ControlProps } from "../form/Control.tsx";
import type { OpenApiSpec, SwaggerEntry } from "./OpenApiSpec.ts";
import type { SwaggerResponseResult } from "./SwaggerResponseView.tsx";

/**
 * How the request body is edited: as fields built from its schema, or as raw
 * JSON in a textarea.
 */
export type SwaggerBodyMode = "form" | "json";

/**
 * Where a form field goes in the request.
 */
export interface SwaggerFieldTarget {
  in: "path" | "query" | "header" | "cookie" | "body" | "field" | "part";
  name: string;
}

/**
 * The form a "try it" panel renders for one operation, and how to read it back.
 */
export interface SwaggerRequestModel {
  schema: ZObject;
  fields: Record<string, Partial<Omit<ControlProps, "input">>>;
  initialValues: Record<string, unknown>;
  targets: Record<string, SwaggerFieldTarget>;
  /**
   * The body's media type, when the operation takes one.
   */
  mediaType?: string;
  /**
   * Whether the body can be edited as fields at all: an object body can, an
   * array or a scalar only as JSON.
   */
  formable: boolean;
  mode: SwaggerBodyMode;
}

/**
 * A request ready for `fetch`.
 */
export interface SwaggerRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: BodyInit;
}

/**
 * Turns an operation into a form, and a submitted form into a request.
 *
 * The form is an ordinary `useForm` schema, built with `jsonSchemaToZod` from
 * the operation's (dereferenced) JSON schemas, so every field is a `Control`
 * and validation is the one the rest of the UI uses:
 *
 * - each path, query and header parameter is a top-level field;
 * - a JSON object body is flattened, one field per property (a nested object
 *   stays a group), or a textarea of raw JSON in `json` mode, which is also
 *   the only mode for a body that is not an object;
 * - a `multipart/form-data` body is flattened, one field per part, a binary
 *   part becoming a file input.
 */
export class SwaggerRequestBuilder {
  protected readonly spec: OpenApiSpec;

  constructor(spec: OpenApiSpec) {
    this.spec = spec;
  }

  public build(
    entry: SwaggerEntry,
    mode: SwaggerBodyMode,
  ): SwaggerRequestModel {
    const shape: Record<string, ZType> = {};
    const fields: SwaggerRequestModel["fields"] = {};
    const initialValues: Record<string, unknown> = {};
    const targets: Record<string, SwaggerFieldTarget> = {};

    for (const param of entry.operation.parameters ?? []) {
      const key = this.uniqueKey(param.name, shape);
      const schema = this.spec.dereference(param.schema);
      let field = jsonSchemaToZod(schema);
      if (param.description) {
        field = field.meta({ description: param.description }) as ZType;
      }
      shape[key] = param.required ? field : (field.optional() as ZType);
      targets[key] = { in: param.in, name: param.name };
      const example = (param as { example?: unknown }).example;
      if (example !== undefined) {
        initialValues[key] = example;
      }
    }

    const content = entry.operation.requestBody?.content ?? {};
    const [mediaType, media] = Object.entries(content)[0] ?? [];
    const required = entry.operation.requestBody?.required !== false;
    const bodySchema = media ? this.spec.dereference(media.schema) : undefined;
    const formable = !!bodySchema?.properties;
    const effective: SwaggerBodyMode = formable ? mode : "json";

    if (mediaType === "multipart/form-data" && bodySchema?.properties) {
      const requiredParts = new Set<string>(bodySchema.required ?? []);
      for (const [name, part] of Object.entries<any>(bodySchema.properties)) {
        const key = this.uniqueKey(name, shape);
        const binary = part?.format === "binary";
        const field = binary ? (z.file() as ZType) : jsonSchemaToZod(part);
        shape[key] = requiredParts.has(name)
          ? field
          : (field.optional() as ZType);
        targets[key] = { in: "part", name };
        if (binary) {
          fields[key] = { file: true };
        }
      }
    } else if (mediaType && bodySchema && effective === "form") {
      const requiredProps = new Set<string>(bodySchema.required ?? []);
      for (const [name, prop] of Object.entries<any>(bodySchema.properties)) {
        const key = this.uniqueKey(name, shape);
        const field = jsonSchemaToZod(prop);
        shape[key] = requiredProps.has(name)
          ? field
          : (field.optional() as ZType);
        targets[key] = { in: "field", name };
      }
    } else if (mediaType && bodySchema) {
      const key = this.uniqueKey("body", shape);
      targets[key] = { in: "body", name: "body" };
      shape[key] = required ? z.richText() : (z.richText().optional() as ZType);
      fields[key] = { area: true, rows: 10 };
      initialValues[key] = JSON.stringify(this.example(bodySchema), null, 2);
    }

    return {
      schema: z.object(shape) as ZObject,
      fields,
      initialValues,
      targets,
      mediaType,
      formable,
      mode: effective,
    };
  }

  /**
   * The request a submitted form describes. `origin` prefixes the path; leave
   * it empty for the page's own origin.
   */
  public request(
    entry: SwaggerEntry,
    model: SwaggerRequestModel,
    values: Record<string, unknown>,
    origin = "",
  ): SwaggerRequest {
    let path = entry.path;
    const query = new URLSearchParams();
    const headers: Record<string, string> = {};
    const parts = new FormData();
    let hasParts = false;
    let body: BodyInit | undefined;
    const json: Record<string, unknown> = {};
    let hasJson = false;

    for (const [key, target] of Object.entries(model.targets)) {
      const value = values[key];
      if (value === undefined || value === null || value === "") {
        continue;
      }
      switch (target.in) {
        case "path":
          path = path.replace(
            `{${target.name}}`,
            encodeURIComponent(this.scalar(value)),
          );
          break;
        case "query":
          for (const item of Array.isArray(value) ? value : [value]) {
            query.append(target.name, this.scalar(item));
          }
          break;
        case "header":
          headers[target.name] = this.scalar(value);
          break;
        case "part":
          hasParts = true;
          if (value instanceof Blob) {
            parts.append(target.name, value);
          } else {
            parts.append(target.name, this.scalar(value));
          }
          break;
        case "field":
          hasJson = true;
          json[target.name] = value;
          break;
        case "body":
          headers["content-type"] = model.mediaType ?? "application/json";
          body =
            model.mode === "json" && typeof value === "string"
              ? value
              : JSON.stringify(value);
          break;
      }
    }

    if (hasJson) {
      headers["content-type"] = model.mediaType ?? "application/json";
      body = JSON.stringify(json);
    }
    if (hasParts) {
      // No content-type: the browser writes the multipart boundary itself.
      body = parts;
    }

    const search = query.toString();
    return {
      method: entry.method.toUpperCase(),
      url: `${origin}${path}${search ? `?${search}` : ""}`,
      headers,
      body,
    };
  }

  /**
   * Read a response as a stream, reporting it after the headers, after each
   * chunk, and once more when it ends (`done`): a server-sent event or a
   * chunked body shows as it arrives rather than when it closes. `elapsed`
   * gives the milliseconds since the request left.
   */
  public async read(
    res: Response,
    elapsed: () => number,
    onResult: (result: SwaggerResponseResult) => void,
  ): Promise<SwaggerResponseResult> {
    const base: SwaggerResponseResult = {
      status: res.status,
      statusText: res.statusText,
      headers: [...res.headers.entries()],
      contentType: res.headers.get("content-type") ?? undefined,
      body: "",
      durationMs: elapsed(),
      done: !res.body,
    };
    onResult(base);
    if (!res.body) {
      return base;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let body = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value, { stream: true });
      onResult({ ...base, body, durationMs: elapsed() });
    }
    body += decoder.decode();
    const result = { ...base, body, durationMs: elapsed(), done: true };
    onResult(result);
    return result;
  }

  /**
   * A sample value for a schema, to seed the raw JSON editor: the schema's
   * own example or default when it has one, else a value of the right shape.
   */
  public example(schema: any, depth = 0): unknown {
    if (!schema || typeof schema !== "object" || depth > 6) {
      return null;
    }
    if (schema.example !== undefined) return schema.example;
    if (Array.isArray(schema.examples) && schema.examples.length) {
      return schema.examples[0];
    }
    if (schema.default !== undefined) return schema.default;
    if (schema.const !== undefined) return schema.const;
    if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
    const variant = (schema.oneOf ?? schema.anyOf)?.find(
      (it: any) => it?.type !== "null",
    );
    if (variant) return this.example(variant, depth + 1);
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    switch (type) {
      case "object": {
        const out: Record<string, unknown> = {};
        for (const [name, prop] of Object.entries<any>(
          schema.properties ?? {},
        )) {
          out[name] = this.example(prop, depth + 1);
        }
        return out;
      }
      case "array":
        return schema.items ? [this.example(schema.items, depth + 1)] : [];
      case "integer":
      case "number":
        return 0;
      case "boolean":
        return false;
      case "string":
        return "";
      default:
        return schema.properties
          ? this.example({ ...schema, type: "object" }, depth)
          : null;
    }
  }

  protected scalar(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      return String(value);
    }
    return JSON.stringify(value) ?? "";
  }

  protected uniqueKey(name: string, shape: Record<string, unknown>): string {
    let key = name;
    let index = 2;
    while (key in shape) {
      key = `${name}${index++}`;
    }
    return key;
  }
}
