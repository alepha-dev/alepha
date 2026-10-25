import type { ZObject } from "../providers/ZodProvider.ts";
import { AlephaError } from "./AlephaError.ts";

/**
 * The base of every error declared with `$error`.
 *
 * Never extended by hand: `$error({ ... })` and `.extend({ ... })` build the
 * subclasses, which is what keeps a declared error a constant that the
 * browser can rebuild from its name. The statics below are read through
 * `new.target`, so each subclass carries its own.
 */
export class DeclaredError extends AlephaError {
  /**
   * Every declared error by name, filled when its constant is declared. A
   * second declaration of a name replaces the first, so a dev server
   * re-evaluating a module never throws.
   */
  static readonly registry = new Map<string, typeof DeclaredError>();

  /**
   * The data schema, the parent's merged with the child's.
   */
  static readonly schema: ZObject | undefined = undefined;

  /**
   * Default data, the parent's merged under the child's.
   */
  static readonly defaults: Record<string, unknown> = {};

  /**
   * The message used when the caller passes none.
   */
  static readonly defaultMessage:
    | string
    | ((data: Record<string, any>) => string)
    | undefined = undefined;

  /**
   * Prose for OpenAPI and the docs.
   */
  static readonly description: string | undefined = undefined;

  /**
   * The error's payload: its defaults merged under what the caller passed.
   */
  public readonly data: Record<string, any>;

  constructor(first?: unknown, second?: unknown) {
    const cls = new.target as typeof DeclaredError;
    const isMessage = typeof first === "string" || first === undefined;
    const data = isMessage ? {} : (first as Record<string, any>);
    const init = (
      isMessage ? { ...(second as object | undefined), message: first } : second
    ) as DeclaredErrorInit | undefined;

    const merged = { ...cls.defaults, ...data };
    const fallback =
      typeof cls.defaultMessage === "function"
        ? cls.defaultMessage(merged)
        : cls.defaultMessage;

    super(
      init?.message ?? fallback ?? cls.name,
      init && "cause" in init ? { cause: init.cause } : undefined,
    );

    this.name = cls.name;
    this.data = merged;
  }

  /**
   * Declare a subclass: what `$error` and every `.extend` call.
   *
   * The child's schema is merged into the parent's and its defaults over the
   * parent's; its name is its own, and it is registered under it.
   */
  static extend(
    this: typeof DeclaredError,
    options: DeclaredErrorOptions,
  ): typeof DeclaredError {
    if (!options.name) {
      throw new AlephaError("An $error needs a name");
    }

    const schema = options.schema
      ? this.schema
        ? this.schema.extend(options.schema.shape)
        : options.schema
      : this.schema;

    const cls = class extends this {};
    Object.defineProperties(cls, {
      name: { value: options.name },
      schema: { value: schema },
      defaults: { value: { ...this.defaults, ...options.default } },
      defaultMessage: { value: options.message ?? this.defaultMessage },
      description: { value: options.description ?? this.description },
    });

    DeclaredError.registry.set(options.name, cls);
    return cls;
  }

  /**
   * This error in `error` or its cause chain, or `undefined`.
   *
   * For an error a library wraps: drizzle demotes the driver's error to
   * `cause` and throws its own on top, so `DbTimeoutError.find(error)` is how
   * a timeout is recognised under it. Bounded, so a cause chain looping on
   * itself cannot hang the error path.
   */
  static find<T extends typeof DeclaredError>(
    this: T,
    error: unknown,
  ): InstanceType<T> | undefined {
    let current: unknown = error;
    for (let depth = 0; depth < 10; depth++) {
      if (current instanceof this) {
        return current as InstanceType<T>;
      }
      if (!(current instanceof Error) || current.cause === undefined) {
        return undefined;
      }
      current = current.cause;
    }
    return undefined;
  }

  /**
   * An error as JSON: `{ name, message, data?, cause? }`.
   */
  static toJSON(error: Error & { data?: Record<string, any> }): ErrorJson {
    const json: ErrorJson = { name: error.name, message: error.message };

    if (error.data && Object.keys(error.data).length > 0) {
      json.data = { ...error.data };
    }

    const cause = error.cause as { name?: unknown; message?: unknown };
    if (
      cause &&
      typeof cause === "object" &&
      typeof cause.name === "string" &&
      typeof cause.message === "string"
    ) {
      json.cause = { name: cause.name, message: cause.message };
    }

    return json;
  }

  /**
   * An error from its JSON, as `toJSON` wrote it.
   *
   * A name registered by this class or one of its descendants yields that
   * class, its data parsed by its schema, so `instanceof` holds on the other
   * side of the wire. A name nothing registered, or data failing the schema,
   * yields an instance of the class it was called on, carrying the name and
   * data it was given. No constructor runs: the fields are copied as they
   * came.
   */
  static fromJSON<T extends typeof DeclaredError>(
    this: T,
    json: ErrorJson,
  ): InstanceType<T> {
    let target: typeof DeclaredError | undefined;
    let data: Record<string, any> = json.data ?? {};

    const found = DeclaredError.registry.get(json.name);
    if (found && (found === this || found.prototype instanceof this)) {
      const parsed = found.schema
        ? found.schema.safeParse(data)
        : { success: true as const, data };
      if (parsed.success) {
        target = found;
        data = parsed.data as Record<string, any>;
      }
    }

    const error = Reflect.construct(
      AlephaError,
      [json.message, json.cause ? { cause: json.cause } : undefined],
      target ?? this,
    ) as DeclaredError;
    error.name = json.name;
    (error as { data: Record<string, any> }).data = data;
    return error as InstanceType<T>;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The last argument of a declared error's constructor, as for `Error`.
 */
export interface DeclaredErrorInit {
  message?: string;
  cause?: unknown;

  /**
   * Never set: it is here so an `Error` passed where the init belongs
   * (`new X("message", error)`, the pre-`$error` positional cause) is a type
   * error rather than a silently overwritten message. Write `{ cause: error }`.
   */
  name?: never;
}

/**
 * What `$error` and `.extend` take, untyped. See `$error` for the typed form.
 */
export interface DeclaredErrorOptions {
  name: string;
  schema?: ZObject;
  default?: Record<string, unknown>;
  message?: string | ((data: any) => string);
  description?: string;
}

/**
 * A declared error on the wire.
 */
export interface ErrorJson {
  name: string;
  message: string;
  data?: Record<string, any>;
  cause?: { name: string; message: string };
}
