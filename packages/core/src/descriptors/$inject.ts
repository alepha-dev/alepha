import type { Service } from "../interfaces/Service.ts";
import { $cursor } from "./$cursor.ts";

/**
 * Get the instance of the specified type from the context.
 *
 * ```ts
 * class A { }
 * class B {
 *   a = $inject(A);
 * }
 * ```
 */
export const $inject = <T extends object>(type: Service<T>): T => {
	const { context, definition, module } = $cursor();

	// _ = $inject(Alepha)
	if (type === context.constructor) {
		return context as T;
	}

	return context.get(type, {
		// keep the parent for better error messages and circular dependencies detection
		parent: definition ?? (context.constructor as Service),
		module,
	});
};
