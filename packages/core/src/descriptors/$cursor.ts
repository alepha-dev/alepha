import type { Alepha } from "../Alepha.ts";
import { MissingContextError } from "../errors/MissingContextError.ts";
import type { Class } from "../interfaces/Class.ts";

/**
 * Global variable!
 *
 * Store the current context and definition during injection phase.
 *
 * @internal
 */
export const __alephaRef: {
	context?: Alepha;
	definition?: Class;
} = {};

/**
 * Cursor descriptor.
 */
export interface CursorDescriptor {
	context: Alepha;
	definition?: Class;
}

/**
 * Get Alepha instance and Class definition from the current context.
 * This should be used inside a descriptor only.
 *
 * ```ts
 * import { $cursor } from "@alepha/core";
 *
 * const $ = () => {
 *
 *   const { context, definition } = $cursor();
 *
 *   // context - alepha instance
 *   // definition - class which is creating this descriptor
 *
 *   return {};
 * }
 *
 * ```
 *
 * @internal
 */
export const $cursor = (): CursorDescriptor => {
	if (!__alephaRef.context) {
		throw new MissingContextError();
	}

	return {
		context: __alephaRef.context,
		definition: __alephaRef.definition,
	};
};
