import type { Static, TObject } from "@sinclair/typebox";
import type { Class } from "../interfaces/Class.ts";
import { TypeGuard } from "../providers/TypeProvider.ts";
import { $cursor } from "./$cursor.ts";

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

	return context.get(type, {
		// keep the parent for better error messages and circular dependencies detection
		parent: definition ?? (context.constructor as Class),
	});
}
