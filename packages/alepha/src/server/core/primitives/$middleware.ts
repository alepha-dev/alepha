import {
  $inject,
  createPrimitive,
  KIND,
  type Middleware,
  Primitive,
} from "alepha";
import type { RouteMethod } from "../constants/routeMethods.ts";
import { ServerRouterProvider } from "../providers/ServerRouterProvider.ts";

export const $middleware = (options: ServerMiddlewarePrimitiveOptions) => {
  return createPrimitive(ServerMiddlewarePrimitive, options);
};

export interface ServerMiddlewarePrimitiveOptions {
  /**
   * Path prefix. Middleware applies to all routes starting with this path.
   *
   * @example "/api" — matches "/api/users", "/api/orders", etc.
   */
  path: string;

  /**
   * Middleware functions to apply to matching routes.
   */
  use: Middleware[];

  /**
   * Limit middleware to specific HTTP methods.
   * If not set, middleware applies to all methods.
   */
  method?: RouteMethod | RouteMethod[];

  /**
   * Exclude specific route paths from middleware application.
   */
  exclude?: string[];
}

export class ServerMiddlewarePrimitive extends Primitive<ServerMiddlewarePrimitiveOptions> {
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);

  protected onInit() {
    const path = this.options.path.replace(/\/+$/, "");
    this.serverRouterProvider.pushMiddleware(`${path}/*`, this.options.use, {
      method: this.options.method,
      exclude: this.options.exclude,
    });
  }
}

$middleware[KIND] = ServerMiddlewarePrimitive;
