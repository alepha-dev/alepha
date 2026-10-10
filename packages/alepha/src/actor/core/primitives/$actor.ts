import {
  $inject,
  AlephaError,
  createPrimitive,
  KIND,
  Primitive,
  type Infer,
  type ZType,
} from "alepha";

import type {
  ActorDeclaration,
  ActorHandle,
  ActorMethods,
} from "../interfaces/ActorInterfaces.ts";
import { ActorCodec } from "../providers/ActorCodec.ts";
import { ActorProvider } from "../providers/ActorProvider.ts";
import { ActorRegistry } from "../providers/ActorRegistry.ts";

/**
 * Declare independent default and keyed actor state from an atom descriptor.
 *
 * The atom supplies a stable name, schema and default, not live actor storage.
 * Node and Bun default to per-container Memory; Redis requires explicit selection
 * and a namespace. Workerd uses a native Durable Object and fails if unbound.
 * Browser and native client execution is unsupported.
 *
 * Methods are pure synchronous reducers of readonly JSON state and arguments.
 * Calls resolve to detached committed state. get(key) is synchronous; read()
 * lazily initializes state. Actor snapshots never synchronize with alepha.store.
 * Redis can rerun reducers on definite conflicts, so reducers must have no I/O,
 * mutable captured dependencies, time/random reads or other side effects.
 * Arguments are captured before the call waits. Reducer inputs are recursively
 * frozen; callers may mutate returned snapshots without changing stored state.
 * Omit optional values instead of passing undefined. Invalid, thrown or Promise
 * transitions preserve state. Incompatible persisted data fails without resetting.
 * A transport error can leave the commit outcome unknown; delivery is not exactly
 * once. Changing a namespace or name selects new state without migrating old data.
 *
 * @example
 * ```ts check
 * import { $atom, Alepha, z } from "alepha";
 * import { $actor } from "alepha/actor";
 *
 * const counter = $atom({ name: "counter", schema: z.integer(), default: 0 });
 * class Counters {
 *   value = $actor({
 *     atom: counter,
 *     methods: { add: (state, amount: number = 1) => state + amount },
 *   });
 * }
 * const counters = Alepha.create().inject(Counters);
 * await counters.value.add(); // default instance: 1
 * await counters.value.get("alice").add(2); // keyed instance: 2
 * await counters.value.read(); // default instance: 1
 * ```
 */
export const $actor = <
  T extends ZType,
  M extends ActorMethods<Infer<T>>,
>(options: {
  atom: ActorDeclaration<T>["atom"];
  methods: M;
}): Omit<ActorPrimitive<T>, "get"> & ActorHandle<Infer<T>, M> => {
  return createPrimitive(ActorPrimitive<T>, options) as Omit<
    ActorPrimitive<T>,
    "get"
  > &
    ActorHandle<Infer<T>, M>;
};

export class ActorPrimitive<T extends ZType = ZType> extends Primitive<
  ActorDeclaration<T>
> {
  protected readonly provider = $inject(ActorProvider);
  protected readonly registry = $inject(ActorRegistry);
  protected readonly codec = $inject(ActorCodec);
  protected declaration!: ActorDeclaration<T>;

  protected override onInit(): void {
    if (this.declaration) return;
    const methods = Object.create(null);
    for (const name of Object.getOwnPropertyNames(this.options.methods)) {
      if (
        name === "then" ||
        name === "__proto__" ||
        name === "constructor" ||
        name === "prototype" ||
        name in this ||
        name in Object.prototype
      )
        throw new AlephaError(`Reserved actor method '${name}'`);
      const descriptor = Object.getOwnPropertyDescriptor(
        this.options.methods,
        name,
      )!;
      const method = descriptor.value;
      if (
        typeof method !== "function" ||
        method.constructor.name === "AsyncFunction"
      )
        throw new AlephaError("Actor reducers must be synchronous functions");
      methods[name] = method;
      Object.defineProperty(this, name, {
        value: (...args: unknown[]) => this.invoke(undefined, name, args),
      });
    }
    this.declaration = {
      atom: this.options.atom,
      methods: Object.freeze(methods),
    };
    this.registry.register(this.declaration);
  }

  /**
   * Lazily initialize the default instance and return its observed snapshot.
   * This does not read, write or subscribe to the ordinary local atom store.
   */
  public read(): Promise<Infer<T>> {
    return this.invoke(undefined);
  }

  /**
   * Synchronously select a nonempty keyed identity without reading storage.
   * The key "default" is distinct from the unkeyed default actor. Calling get
   * again selects a key in the same declaration, not a nested identity.
   */
  public get(key: string): ActorHandle<Infer<T>, ActorMethods<Infer<T>>> {
    if (typeof key !== "string" || !key.length)
      throw new AlephaError("Actor key must be a nonempty string");
    const handle: Record<string, unknown> = Object.create(null);
    handle.read = () => this.invoke(key);
    handle.get = (next: string) => this.get(next);
    for (const method of Object.keys(this.declaration.methods))
      handle[method] = (...args: unknown[]) => this.invoke(key, method, args);
    return Object.freeze(handle) as ActorHandle<
      Infer<T>,
      ActorMethods<Infer<T>>
    >;
  }

  protected invoke(
    key?: string,
    method?: string,
    args: unknown[] = [],
  ): Promise<Infer<T>> {
    try {
      return this.provider.execute({
        name: this.declaration.atom.key,
        key,
        method,
        args: this.codec.copy(args),
      }) as Promise<Infer<T>>;
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

$actor[KIND] = ActorPrimitive;
