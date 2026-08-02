import { AlephaError } from "../errors/AlephaError.ts";
import type { Infer, ZObject } from "../providers/ZodProvider.ts";
import { z } from "../providers/ZodProvider.ts";
import { $context } from "./$context.ts";

/**
 * Get typed values from environment variables.
 *
 * @example
 * ```ts
 * const alepha = Alepha.create({
 *   env: {
 *     // Alepha.create() will also use process.env when running on Node.js
 *     HELLO: "world",
 *   }
 * });
 *
 * class App {
 *   log = $logger();
 *
 *   // program expect a var env "HELLO" as string to works
 *   env = $env(z.object({
 *     HELLO: z.text()
 *   }));
 *
 *   sayHello = () => this.log.info("Hello ${this.env.HELLO}")
 * }
 *
 * run(alepha.with(App));
 * ```
 */
export const $env = <T extends ZObject>(type: T): Infer<T> => {
  const { alepha, service, module } = $context();

  // allow to inject Zod schemas
  if (!z.schema.isObject(type)) {
    throw new AlephaError("Type must be an ZObject");
  }

  // Pass the declaring service/module through so tooling can attribute each
  // variable to its source instead of showing one flat, unsourced list.
  return alepha.parseEnv(type, {
    service: service?.name,
    module: module?.name,
  }) as Infer<T>;
};
