import type { Alepha } from "../Alepha";
import { MissingContextError } from "../errors/MissingContextError";
import type { Class } from "../interfaces/Class";

/**
 * Used to store the current context and definition during injections.
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
 *
 * This should be used inside a descriptor only.
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
