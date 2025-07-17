// ---------------------------------------------------------------------------------------------------------------------

/**
 * Represents a value that can be either a value or a promise of value.
 */
export type Async<T> = T | Promise<T>;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Represents a function that returns an async value.
 */
export type AsyncFn = (...args: any[]) => Async<any>;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Transforms a type T into a promise if it is not already a promise.
 */
export type MaybePromise<T> = T extends Promise<any> ? T : Promise<T>;

// ---------------------------------------------------------------------------------------------------------------------
