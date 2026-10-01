// ---------------------------------------------------------------------------------------------------------------------

/**
 * In Alepha, a service is a class that can be instantiated or an abstract class. Nothing more, nothing less...
 */
export type Service<T extends object = any> =
  | InstantiableClass<T>
  | AbstractClass<T>
  | RunFunction<T>;

export type RunFunction<T extends object = any> = (
  ...args: any[]
) => T | undefined;

export type InstantiableClass<T extends object = any> = new (
  ...args: any[]
) => T;

/**
 * Abstract class is a class that cannot be instantiated directly!
 * It widely used for defining interfaces.
 */
export type AbstractClass<T extends object = any> = abstract new (
  ...args: any[]
) => T;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Service substitution allows you to register a class as a different class.
 * Providing class A, but using class B instead.
 * This is useful for testing, mocking, or providing a different implementation of a service.
 *
 * class A is mostly an AbstractClass, while class B is an InstantiableClass.
 */
export interface ServiceSubstitution<T extends object = any> {
  /**
   * Every time someone asks for this class, it will be provided with the 'use' class.
   */
  provide: Service<T>;

  /**
   * Service to use instead of the 'provide' service.
   *
   * Syntax is inspired by Angular's DI system.
   */
  use: Service<T>;

  /**
   * If true, if the service already exists -> just ignore the substitution and do not throw an error.
   * Mostly used for plugins to enforce a substitution without throwing an error.
   */
  optional?: boolean;
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

export function isClass(func: any): func is InstantiableClass {
  // Classes have a non-writable prototype.constructor
  if (typeof func !== "function") return false;

  const descriptor = Object.getOwnPropertyDescriptor(func, "prototype");
  return !!descriptor && !descriptor.writable;
}
