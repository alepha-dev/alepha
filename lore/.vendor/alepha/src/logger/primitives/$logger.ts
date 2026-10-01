import { $context, $inject, KIND } from "alepha";

import { Logger } from "../services/Logger.ts";

/**
 * Create a logger.
 *
 * `name` is optional, by default it will use the name of the service.
 *
 * @example
 * ```ts
 * import { $logger } from "alepha/logger";
 *
 * class MyService {
 * 	log = $logger();
 *
 *   constructor() {
 *     this.log.info("Service initialized");
 *     // print something like '[23:45:53.326] INFO <app.MyService>: Service initialized'
 *   }
 * }
 * ```
 */
export const $logger = (options: LoggerPrimitiveOptions = {}): Logger => {
  const { alepha, service, module } = $context();

  return $inject(Logger, {
    lifetime: "transient",
    args: [
      options.name ?? service?.name ?? "Func",
      module?.name ?? alepha.env.MODULE_NAME ?? "app",
    ],
  });
};

export interface LoggerPrimitiveOptions {
  name?: string;
}

$logger[KIND] = Logger;
