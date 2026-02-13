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

  public has(key: string): boolean {
    if (!this.als) {
      return false;
    }

    const store = this.als.getStore();
    if (!store) {
      return false;
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
