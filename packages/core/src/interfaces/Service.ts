// ---------------------------------------------------------------------------------------------------------------------

/**
 * In Alepha, a service is a class that can be instantiated. Nothing more, nothing less.
 */
export interface Service<T extends object = any> {
	// generic is used for convenience, but not required
	// new constructor is mandatory, to enforce the ""class"" type
	new (...args: any[]): T;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Service substitution allows you to register a class as a different class.
 */
export interface ServiceSubstitution<T extends object = any> {
	/**
	 * Every time someone asks for this service, it will be provided with the 'use' service.
	 */
	provide: Service<T>;

	/**
	 * Service to use instead of the 'provide' service.
	 *
	 * Note: Syntax is based on Angular's DI system.
	 */
	use: Service<T>;

	/**
	 * If true, will not throw an error if the service already exists.
	 * Mostly used for plugins to enforce a substitution without throwing an error.
	 */
	default?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Every time you register a service, you can use this type to define it.
 *
 * alepha.with( ServiceEntry )
 * or
 * alepha.with( provide: ServiceEntry, use: MyOwnServiceEntry )
 *
 * And yes, you declare the *type* of the service, not the *instance*.
 */
export type ServiceEntry<T extends object = any> =
	| Service<T>
	| ServiceSubstitution<T>;

// ---------------------------------------------------------------------------------------------------------------------
