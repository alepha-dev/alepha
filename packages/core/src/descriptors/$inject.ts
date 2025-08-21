import { Descriptor } from "../helpers/descriptor.ts";
import type { InstantiableClass, Service } from "../interfaces/Service.ts";
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
export const $inject = <T extends object>(
	type: Service<T>,
	opts: InjectOptions<T> = {},
): T => {
	const { context, definition } = $cursor();

	// _ = $inject(Alepha)
	if (type === context.constructor) {
		return context as T;
	}

	return context.inject(type, {
		// keep the parent for better error messages and circular dependencies detection
		parent: definition ?? (context.constructor as Service),
		...opts,
	});
};

export class InjectDescriptor extends Descriptor {}

export interface InjectOptions<T extends object = any> {
	/**
	 * Ignore current existing instance.
	 */
	skipCache?: boolean;
	/**
	 * Don't store the instance in the registry.
	 */
	skipRegistration?: boolean;
	/**
	 * Constructor arguments to pass when creating a new instance.
	 */
	args?: ConstructorParameters<InstantiableClass<T>>;
	/**
	 * Parent service that requested the instance.
	 * @internal
	 */
	parent?: Service | null;
}
