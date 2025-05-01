import type { TObject } from "@sinclair/typebox";
import { PROVIDER } from "../constants/PROVIDER";
import type { Class } from "../interfaces/Class";
import type { Static } from "../providers/TypeProvider";
import { TypeGuard } from "../providers/TypeProvider";
import { $cursor } from "./$cursor";

/**
 * Get the instance of the specified type from the context.
 *
 * - If the type is a class, it will be resolved from the context.
 * - If the type is a schema, it will be parsed from the environment.
 *
 * ```ts
 * class A { }
 * class B {
 *   a = $inject(A);
 * }
 * ```
 *
 * @param type - Type (or TypeBox schema) to resolve
 * @returns Instance of the specified type
 */
export function $inject<T extends TObject>(type: T): Static<T>;
export function $inject<T extends object>(type: Class<T>): T;
export function $inject<T extends object>(type: Class<T> | TObject): T {
	const { context, definition } = $cursor();

	// allow to inject TypeBox schemas
	if (TypeGuard.IsSchema(type)) {
		return context.parseEnv(type) as T;
	}

	// _ = $inject(Alepha)
	if (type === context.constructor) {
		return context as T;
	}

	const value = context.get(type, {
		// keep the parent for better error messages
		parent: definition ?? (context.constructor as Class),
	});

	// clone the value to prevent accidental modifications
	const clone = Object.create(value);

	// mark the clone as a provider and keep the original type
	// - this is mandatory for class swapping
	clone[PROVIDER] = type;

	return clone;
}
