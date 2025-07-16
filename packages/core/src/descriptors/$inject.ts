import type { Static, TObject } from "@sinclair/typebox";
import { KIND } from "../constants/KIND.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import { descriptorEvents } from "../helpers/descriptor.ts";
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
export function $inject<T extends TObject>(type: T): Static<T>; // env
export function $inject<T extends object>(type: Service<T>): T; // services
export function $inject<T extends object>(type: any): any {
	const { context, definition, module } = $cursor();

	descriptorEvents.emit("create", {
		context,
		definition,
		module,
		[KIND]: "INJECT",
		provider: type,
	});

	// allow to inject TypeBox schemas
	if (TypeGuard.IsObject(type)) {
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

	const value = $injectResolverRegistry.resolve(type);
	if (value) {
		return value;
	}

	return context.get(type, {
		// keep the parent for better error messages and circular dependencies detection
		parent: definition ?? (context.constructor as Service),
		module,
	});
}

class InjectResolverRegistry {
	resolvers: Array<(it: any) => any> = [];
	register(fn: (it: any) => any): void {
		this.resolvers.push(fn);
	}
	resolve(it: any): any {
		for (const fn of this.resolvers) {
			const result = fn(it);
			if (result) {
				return result;
			}
		}
	}
}

export const $injectResolverRegistry: InjectResolverRegistry =
	new InjectResolverRegistry();
