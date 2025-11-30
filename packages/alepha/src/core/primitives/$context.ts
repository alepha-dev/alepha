import type { Alepha } from "../Alepha.ts";
import { MODULE } from "../constants/MODULE.ts";
import { MissingContextError } from "../errors/MissingContextError.ts";
import { __alephaRef } from "../helpers/ref.ts";
import type { Service } from "../interfaces/Service.ts";

/**
 * Get Alepha instance and current service from the current context.
 *
 * It can only be used inside $primitive functions.
 *
 * ```ts
 * import { $context } from "alepha";
 *
 * const $hello = () => {
 *   const { alepha, service, module } = $context();
 *
 *   // alepha - alepha instance
 *   // service - class which is creating this primitive, this is NOT the instance but the service definition
 *   // module - module definition, if any
 *
 *   return {};
 * }
 *
 * class MyService {
 *   hello = $hello();
 * }
 *
 * const alepha = new Alepha().with(MyService);
 * ```
 *
 * @internal
 */
export const $context = (): ContextPrimitive => {
  if (!__alephaRef.alepha) {
    throw new MissingContextError();
  }

  return {
    alepha: __alephaRef.alepha,
    service: __alephaRef.service,
    module: __alephaRef.service?.[MODULE],
  };
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ContextPrimitive {
  /**
   * Alepha instance.
   */
  alepha: Alepha;
  /**
   * Service definition which is creating this primitive.
   * This is NOT the instance but the service definition.
   */
  service?: Service;
  /**
   * Module definition, if any.
   */
  module?: Service;
}
