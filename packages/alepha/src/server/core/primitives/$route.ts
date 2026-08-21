import {
  $inject,
  createPrimitive,
  KIND,
  PipelinePrimitive,
  type PipelinePrimitiveOptions,
} from "alepha";

import { ServerReply } from "../helpers/ServerReply.ts";
import type {
  RequestConfigSchema,
  ServerHandler,
  ServerRequest,
  ServerRoute,
} from "../interfaces/ServerRequest.ts";
import { ServerRouterProvider } from "../providers/ServerRouterProvider.ts";

/**
 * Create a basic endpoint.
 *
 * It's a low level primitive. You probably want to use `$action` instead.
 *
 * @see {@link $action}
 * @see {@link $page}
 */
export const $route = <TConfig extends RequestConfigSchema>(
  options: RoutePrimitiveOptions<TConfig>,
): RoutePrimitive<TConfig> => {
  return createPrimitive(RoutePrimitive<TConfig>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RoutePrimitiveOptions<
  TConfig extends RequestConfigSchema = RequestConfigSchema,
>
  extends
    Omit<ServerRoute<TConfig>, "handler">,
    PipelinePrimitiveOptions<ServerHandler<TConfig>> {}

// ---------------------------------------------------------------------------------------------------------------------

export class RoutePrimitive<
  TConfig extends RequestConfigSchema,
> extends PipelinePrimitive<RoutePrimitiveOptions<TConfig>> {
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);

  protected onInit() {
    this.serverRouterProvider.createRoute({
      ...(this.options as any),
      handler: this.handler,
    } as ServerRoute<TConfig>);
  }

  /**
   * Invoke this route's handler in-process (no HTTP server) and return its path
   * and body. Used by the build to snapshot `static` routes to files.
   *
   * Only meaningful for self-contained `GET` handlers that return a string or
   * Buffer (e.g. `sitemap.xml`, `robots.txt`).
   */
  public async prerender(): Promise<{ path: string; body: string | Buffer }> {
    const reply = new ServerReply();
    const request = {
      method: this.options.method ?? "GET",
      url: new URL(`http://localhost${this.options.path}`),
      params: {},
      query: {},
      headers: {},
      body: undefined,
      metadata: {},
      reply,
    } as unknown as ServerRequest<TConfig>;

    const result = await this.handler.run(request);
    const body = (result ?? reply.body) as string | Buffer;
    return { path: this.options.path, body };
  }
}

$route[KIND] = RoutePrimitive;
