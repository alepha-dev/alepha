import {
  $inject,
  createPrimitive,
  KIND,
  PipelinePrimitive,
  type PipelinePrimitiveOptions,
} from "alepha";
import type {
  RequestConfigSchema,
  ServerHandler,
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
> extends Omit<ServerRoute<TConfig>, "handler">,
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
}

$route[KIND] = RoutePrimitive;
