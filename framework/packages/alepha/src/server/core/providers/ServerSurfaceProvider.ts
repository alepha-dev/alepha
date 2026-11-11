import {
  $hook,
  $inject,
  $store,
  Alepha,
  type AppSurfaceAction,
  type AppSurfaceRoute,
  type Service,
} from "alepha";

import { HttpError } from "../errors/HttpError.ts";
import type { ServerRequestData } from "../interfaces/ServerRequest.ts";
import {
  type ActionPrimitive,
  serverApiOptions,
} from "../primitives/$action.ts";
import { ServerRouterProvider } from "./ServerRouterProvider.ts";

/**
 * The HTTP surface of the classes a module declared and has not created
 * (#Q3403).
 *
 * With a build list, a pure controller is declared at registration and not
 * created. This provider fills the router from the list instead: one
 * placeholder per route of a declared class, which creates the class on the
 * first request that matches it. The class's own `$action.onInit` then
 * registers the real route in the placeholder's place, and the request is
 * dispatched to it. A cron, a queue message or any other event creates no
 * declared class.
 *
 * Without a list nothing is declared, and this provider does nothing.
 */
export class ServerSurfaceProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly router = $inject(ServerRouterProvider);
  protected readonly api = $store(serverApiOptions);

  /**
   * The list's actions of the declared classes, with the class to create.
   */
  public declaredActions(): Array<{
    action: AppSurfaceAction;
    service: Service;
  }> {
    return this.declaredRows(this.alepha.surface?.actions ?? []);
  }

  /**
   * Creates the class holding an action of the list and returns the action,
   * once created. Undefined when the class or the action is not there.
   */
  public resolveAction(
    row: AppSurfaceAction,
  ): ActionPrimitive<any> | undefined {
    const service = this.alepha.declaredByKey(row.class);
    if (service) {
      this.alepha.inject(service);
    }
    return (this.alepha.primitives("$action") as ActionPrimitive<any>[]).find(
      (it) => it.name === row.name && it.group === row.group,
    );
  }

  /**
   * Fills the router before anything reads its routes (CORS reads them at
   * start).
   */
  protected readonly placeholders = $hook({
    on: "configure",
    priority: "first",
    handler: () => {
      const prefix = this.api.prefix ?? "";
      for (const { action, service } of this.declaredActions()) {
        this.placeholder(action.method, `${prefix}${action.path}`, service);
      }
      for (const { action: route, service } of this.declaredRows(
        this.alepha.surface?.routes ?? [],
      )) {
        this.placeholder(route.method, route.path, service);
      }
    },
  });

  protected declaredRows<T extends AppSurfaceAction | AppSurfaceRoute>(
    rows: T[],
  ): Array<{ action: T; service: Service }> {
    const found: Array<{ action: T; service: Service }> = [];
    for (const row of rows) {
      const service = this.alepha.declaredByKey(row.class);
      if (service) {
        found.push({ action: row, service });
      }
    }
    return found;
  }

  protected placeholder(method: string, path: string, service: Service): void {
    const verb = method.toUpperCase();
    this.router.createPlaceholder(verb, path, (request: ServerRequestData) => {
      // Synchronous, so two concurrent first requests create the class once.
      this.alepha.inject(service);
      const { route } = this.router.match(`/${verb}${request.url.pathname}`);
      if (!route || route.placeholder) {
        throw new HttpError(
          { status: 500 },
          {
            message: `${service.name} was created and registered no route for ${verb} ${path}`,
          },
        );
      }
      return route.handler(request);
    });
  }
}
