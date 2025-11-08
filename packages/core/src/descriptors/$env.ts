import type { Static, TObject } from "typebox";
import { AlephaError } from "../errors/AlephaError.ts";
import { t } from "../providers/TypeProvider.ts";
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
 *   env = $env(t.object({
 *     HELLO: t.text()
 *   }));
 *
 *   sayHello = () => this.log.info("Hello ${this.env.HELLO}")
 * }
 *
 * run(alepha.with(App));
 * ```
 */
export const $env = <T extends TObject>(type: T): Static<T> => {
  const { alepha } = $context();

  // allow to inject TypeBox schemas
  if (!t.schema.isObject(type)) {
    throw new AlephaError("Type must be an TObject");
  }

  return alepha.parseEnv(type) as Static<T>;
};
