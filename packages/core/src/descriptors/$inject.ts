import type { Static, TObject } from "@sinclair/typebox";
import { AlephaError } from "../errors/AlephaError.ts";
import type { Service } from "../interfaces/Service.ts";
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
export function $inject<T extends object>(type: Service<T>): T;
export function $inject<T extends object>(type: Service<T> | TObject): T {
	const { context, definition, module } = $cursor();

	// allow to inject TypeBox schemas
	if (TypeGuard.IsSchema(type)) {
		return context.parseEnv(type) as T;
	}

	// _ = $inject(Alepha)
	if (type === context.constructor) {
		return context as T;
	}

	// $module descriptor
	const moduleOfType = context.getModuleOf(type);
	if (module && moduleOfType && moduleOfType !== module) {
		throw new AlephaError(
			`Cannot inject '${moduleOfType.name}/${type.name}' into '${module.name}/${definition?.name}'. Service does not belong to the module.`,
		);
	}

	return context.get(type, {
		// keep the parent for better error messages and circular dependencies detection
		parent: definition ?? (context.constructor as Service),
		module,
	});
}

/**
 * @alias $inject
 */
export const $env = $inject;
