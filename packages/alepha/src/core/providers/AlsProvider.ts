import type { AsyncLocalStorage } from "node:async_hooks";

export type AsyncLocalStorageData = any;
export type StateScope = "current" | "app" | "parent";

export const ALS_PARENT = Symbol("als.parent");

export class AlsProvider {
  static create = (): AsyncLocalStorage<AsyncLocalStorageData> | undefined => {
    return undefined;
  };

  public als?: AsyncLocalStorage<AsyncLocalStorageData>;

  constructor() {
    this.als = AlsProvider.create();
  }

  public createContextId(): string {
    return crypto.randomUUID();
  }

  public run<R>(callback: () => R, data: Record<string, any> = {}): R {
    if (!this.als) {
      return callback();
    }

    const parent = this.als.getStore() ?? undefined;

    // Intentional mutation: set defaults on the input object to avoid
    // allocating an intermediate copy. Callers always pass a fresh literal.
    data.registry ??= new Map();
    data.context ??= this.createContextId();

    return this.als.run({ ...data, [ALS_PARENT]: parent }, callback);
  }

  /**
   * Run `callback` in a child layer that keeps the caller's identity.
   *
   * The difference from {@link run} is what this layer does *not* mint: no new
   * correlation id, no new scoped registry. A nested scope is the same unit of
   * work as its caller, and inventing either would break something — a fresh
   * `context` detaches the callback's logs from the request that caused them,
   * and a fresh `registry` hands it different `scoped` instances than the
   * caller itself is holding.
   *
   * What it does give is a private layer to write into. `set` always targets
   * the innermost layer, so a value stored here is invisible to siblings and
   * dies with the callback, while reads still walk up to the caller. That is
   * what lets two concurrent callers each keep a marker of their own under the
   * same key — a database transaction, say.
   *
   * With no ALS at all (browser builds) this is `callback()`, like {@link run}.
   * With no active parent it mints a correlation id and nothing else, because a
   * layer that does not register as a context is one that `StateManager` writes
   * straight past into the app-wide store — which is the very thing the caller
   * asked to avoid.
   */
  public nest<R>(callback: () => R): R {
    if (!this.als) {
      return callback();
    }

    const parent = this.als.getStore() ?? undefined;
    const layer: AsyncLocalStorageData = { [ALS_PARENT]: parent };

    if (!parent) {
      layer.context = this.createContextId();
    }

    return this.als.run(layer, callback);
  }

  public exists(): boolean {
    return !!this.get("context");
  }

  public get<T>(key: string, scope?: StateScope): T | undefined {
    if (!this.als) {
      return undefined;
    }

    const store = this.als.getStore();
    if (!store) {
      return undefined;
    }

    if (scope === "app") {
      return undefined;
    }

    if (scope === "current") {
      return key in store ? (store[key] as T) : undefined;
    }

    if (scope === "parent") {
      return store[ALS_PARENT]?.[key] as T | undefined;
    }

    // Default: walk up the tree from current layer to root
    if (key in store) {
      return store[key] as T;
    }

    let current = store[ALS_PARENT];
    while (current) {
      if (key in current) {
        return current[key] as T;
      }
      current = current[ALS_PARENT];
    }

    return undefined;
  }

  /**
   * Return the raw ALS layer object that owns `key`, walking from the
   * current layer up through parent forks — the same resolution order as
   * the default-scope branch of {@link get}. Returns `undefined` when no
   * active ALS layer (current or any ancestor) has the key.
   *
   * Used by `StateManager.register()` to decode a value in place, in
   * whichever fork layer it physically lives, instead of flattening
   * fork-scoped state into the app-level store.
   */
  public getLayer(key: string): AsyncLocalStorageData {
    if (!this.als) {
      return undefined;
    }

    let current = this.als.getStore();
    while (current) {
      if (key in current) {
        return current;
      }
      current = current[ALS_PARENT];
    }

    return undefined;
  }

  /**
   * Whether `key` is present for the given scope — the presence counterpart
   * of {@link get}, resolving through exactly the same layers.
   *
   * A caller cannot use `get() !== undefined` for this: a layer may legally
   * hold `null` or `undefined`, and treating that as "absent" leaks the value
   * of whatever layer sits behind it.
   */
  public has(key: string, scope?: StateScope): boolean {
    if (!this.als) {
      return false;
    }

    const store = this.als.getStore();
    if (!store) {
      return false;
    }

    if (scope === "app") {
      return false;
    }

    if (scope === "current") {
      return key in store;
    }

    if (scope === "parent") {
      return !!store[ALS_PARENT] && key in store[ALS_PARENT];
    }

    if (key in store) {
      return true;
    }

    let current = store[ALS_PARENT];
    while (current) {
      if (key in current) {
        return true;
      }
      current = current[ALS_PARENT];
    }

    return false;
  }

  public set<T>(key: string, value: T): void {
    if (!this.als) {
      return;
    }

    const store = this.als.getStore();
    if (store) {
      store[key] = value;
    }
  }
}
