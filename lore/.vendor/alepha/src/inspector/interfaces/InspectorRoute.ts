import type { Infer, ZObject, ZType } from "alepha";

/**
 * The HTTP methods the inspector protocol uses.
 */
export type InspectorMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * What one inspector endpoint accepts and answers.
 *
 * `response` is mandatory: like a `$route`, the response schema is what
 * serializes, so a field it does not declare never leaves the process.
 */
export interface InspectorRouteSchema {
  params?: ZObject;
  query?: ZObject;
  body?: ZType;
  response: ZType;
}

/**
 * The validated request a handler receives, whatever transport carried it.
 */
export interface InspectorRequest<
  T extends InspectorRouteSchema = InspectorRouteSchema,
> {
  params: T["params"] extends ZObject
    ? Infer<T["params"]>
    : Record<string, string>;
  query: T["query"] extends ZObject
    ? Infer<T["query"]>
    : Record<string, string>;
  body: T["body"] extends ZType ? Infer<T["body"]> : undefined;
}

/**
 * What a handler resolves to: the response schema's type.
 */
export type InspectorResponse<T extends InspectorRouteSchema> = Infer<
  T["response"]
>;

/**
 * One endpoint of the inspector protocol.
 *
 * Deliberately independent of `$route`: the same table is served over the
 * per-process socket, mounted on the app server by the in-app devtools, and
 * read by the typed client, and none of those should depend on the others.
 * `path` is relative to whatever base the transport serves it under
 * (`/metadata`, `/jobs/:name/executions`).
 */
export interface InspectorRoute<
  T extends InspectorRouteSchema = InspectorRouteSchema,
> {
  method: InspectorMethod;
  path: string;
  schema: T;
  handler: (
    request: InspectorRequest<T>,
  ) => InspectorResponse<T> | Promise<InspectorResponse<T>>;
}
