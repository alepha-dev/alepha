import type { Alepha } from "../Alepha.ts";
import { MODULE } from "../constants/MODULE.ts";
import { MissingContextError } from "../errors/MissingContextError.ts";
import { __alephaRef } from "../helpers/ref.ts";
import type { Service } from "../interfaces/Service.ts";

/**
 * Get Alepha instance and current service from the current context.
 *
 * It can only be used inside $descriptor functions.
 *
 * ```ts
 * import { $context } from "alepha";
 *
 * const $hello = () => {
 *   const { alepha, service, module } = $context();
 *
 *   // alepha - alepha instance
 *   // service - class which is creating this descriptor, this is NOT the instance but the service definition
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
export const $context = (): ContextDescriptor => {
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

export interface ContextDescriptor {
  /**
   * Alepha instance.
   */
  alepha: Alepha;
  /**
   * Service definition which is creating this descriptor.
   * This is NOT the instance but the service definition.
   */
  service?: Service;
  /**
   * Module definition, if any.
   */
  module?: Service;
}
