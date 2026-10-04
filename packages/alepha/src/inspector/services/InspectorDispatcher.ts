import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

import { InspectorRoutes } from "../providers/InspectorRoutes.ts";

/**
 * A request to the inspector protocol, as any transport delivers it.
 */
export interface InspectorDispatchRequest {
  method: string;
  /**
   * Relative to the transport's base: `/logs`, `/jobs/send/executions`.
   */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

export interface InspectorDispatchResponse {
  status: number;
  body: unknown;
}

/**
 * Runs one request against the inspector's route table: match, validate the
 * input, call the handler, encode the output through the response schema.
 *
 * Transport-free on purpose. The socket server is a thin `node:http` shell
 * around it, and specs call it directly, so the protocol's behaviour is
 * tested once rather than once per way of reaching it.
 */
export class InspectorDispatcher {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly routes = $inject(InspectorRoutes);

  public async dispatch(
    request: InspectorDispatchRequest,
  ): Promise<InspectorDispatchResponse> {
    const found = this.routes.match(request.method, request.path);
    if (!found) {
      return {
        status: 404,
        body: {
          message: `No inspector route ${request.method} ${request.path}`,
        },
      };
    }

    const { route, params } = found;
    const { schema } = route;
    const codec = this.alepha.codec;

    let input: { params: any; query: any; body: any };
    try {
      input = {
        params: schema.params ? codec.validate(schema.params, params) : params,
        query: schema.query
          ? codec.validate(schema.query, request.query ?? {})
          : (request.query ?? {}),
        body: schema.body
          ? codec.validate(schema.body, request.body)
          : undefined,
      };
    } catch (error) {
      return {
        status: 400,
        body: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    try {
      const result = await route.handler(input);
      return { status: 200, body: codec.encode(schema.response, result) };
    } catch (error) {
      this.log.warn(`Inspector route ${route.method} ${route.path} failed`, {
        error,
      });
      return {
        status: 500,
        body: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
