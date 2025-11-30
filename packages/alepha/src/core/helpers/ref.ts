import type { Alepha } from "../Alepha.ts";
import { MODULE } from "../constants/MODULE.ts";
import type { Service } from "../interfaces/Service.ts";

/**
 * Store the current context and definition during injection phase.
 *
 * @internal
 */
export const __alephaRef: {
  alepha?: Alepha;
  service?: Service & {
    [MODULE]?: Service;
  };
  parent?: Service;
} = {};

/**
 * Note:
 *
 * This file is used to share context between $primitives and the Alepha core during the injection phase.
 *
 * There is no side effect as long as Alepha is not used concurrently in multiple contexts (which is not the case).
 *
 * // __alephaRef === undefined
 * // begin alepha.with()
 * //   __alephaRef.context = alepha
 * //   ... injection phase ...
 * //   __alephaRef.context = undefined
 * // end alepha.with()
 * // __alephaRef === undefined
 *
 * As .with() is synchronous, there is no risk of context leakage.
 *
 * ---------------------------------------------------------------------------------------------------------------------
 *
 * Why this helper?
 *
 * It allows to avoid passing Alepha instance to every $hook, $inject, etc. calls. It's a beautiful syntactic sugar.
 *
 * With sugar:
 *
 * class A {
 *   on = $hook( ... ) // <- __alephaRef is set here
 * }
 *
 * Without sugar:
 *
 * class A {
 *   constructor(alepha: Alepha) {
 *     this.on = $hook(alepha, ... ) // <- no need of __alephaRef
 *   }
 * }
 *
 * One main goal of Alepha is working with classes but without the class verbosity.
 * Forcing to pass Alepha instance in constructors would be a step back in that direction!
 */
