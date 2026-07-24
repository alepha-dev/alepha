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
  public getLayer(key: string): AsyncLocalStorageData | undefined {
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
