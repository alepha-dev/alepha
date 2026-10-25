import type { InspectorRoutes } from "../providers/InspectorRoutes.ts";
import type {
  InspectorRequest,
  InspectorResponse,
  InspectorRoute,
  InspectorRouteSchema,
} from "./InspectorRoute.ts";

/**
 * The name of an inspector route: `"metadata"`, `"logs"`, `"dbList"`...
 */
export type InspectorRouteName = keyof InspectorRoutes["routes"];

/**
 * The schema of one named route, read off the route table's own type.
 */
export type InspectorRouteSchemaOf<K extends InspectorRouteName> =
  InspectorRoutes["routes"][K] extends InspectorRoute<infer T>
    ? T
    : InspectorRouteSchema;

/**
 * What a client sends to a named route. Each part is present when the route
 * declares it.
 */
export interface InspectorCallRequest<K extends InspectorRouteName> {
  params?: InspectorRequest<InspectorRouteSchemaOf<K>>["params"];
  query?: Partial<InspectorRequest<InspectorRouteSchemaOf<K>>["query"]>;
  body?: InspectorRequest<InspectorRouteSchemaOf<K>>["body"];
}

/**
 * What a named route answers.
 */
export type InspectorCallResponse<K extends InspectorRouteName> =
  InspectorResponse<InspectorRouteSchemaOf<K>>;
