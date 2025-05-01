/**
 * Represents a generic definition type in TypeScript.
 */
export interface Class<T extends object = any> {
	new (...args: any[]): T;
}

/**
 *
 */
export interface ClassSwap<T extends object = any> {
	/**
	 * Class to register.
	 */
	provide: Class<T>;

	/**
	 * Class to use AS the provided class.
	 */
	use: Class<T>;

	/**
	 * If true, "use" only if class is not already registered.
	 */
	default?: boolean;

	/**
	 * If true, class will be removed if nobody is using it.
	 */
	optional?: boolean;
}

/**
 *
 */
export type ClassEntry<T extends object = any> = Class<T> | ClassSwap<T>;

/**
 * Represents a definition for a class.
 */
export interface ClassProvider<T extends object = any> {
	/**
	 * The class or type definition to provide.
	 */
	provide: Class<T>;

	/**
	 * The class or type definition to use. This will override the 'provide' property.
	 */
	use?: Class<T>;

	/**
	 * The instance of the class or type definition.
	 * Mostly used for caching / singleton but can be used for other purposes like forcing the instance.
	 */
	instance: T;

	/**
	 * List of classes which use this class.
	 */
	parents: Array<Class | null>;
}
