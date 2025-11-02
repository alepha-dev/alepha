import type { State as AlephaState } from "../Alepha.ts";
import { $inject } from "../descriptors/$inject.ts";
import { AlsProvider } from "./AlsProvider.ts";
import { EventManager } from "./EventManager.ts";

export class StateManager<State extends object = AlephaState> {
  protected readonly als = $inject(AlsProvider);
  protected readonly events = $inject(EventManager);

  protected store: Partial<State> = {};

  constructor(store: Partial<State> = {}) {
    this.store = store;
  }

  /**
   * Get a value from the state with proper typing
   */
  public get<Key extends keyof State>(key: Key): State[Key] | undefined {
    if (this.als?.exists()) {
      return this.als.get<State[Key]>(key as string) ?? this.store[key];
    }
    return this.store[key];
  }

  /**
   * Set a value in the state
   */
  public set<Key extends keyof State>(
    key: Key,
    value: State[Key] | undefined,
  ): this {
    const prevValue = this.get(key);
    if (prevValue === value) {
      return this;
    }

    if (this.als?.exists()) {
      this.als.set(key as string, value);
    } else {
      this.store[key] = value;
    }

    this.events
      ?.emit(
        "state:mutate",
        { key: key as keyof AlephaState, value, prevValue },
        { catch: true },
      )
      .catch(() => null);

    return this;
  }

  /**
   * Check if a key exists in the state
   */
  public has<Key extends keyof State>(key: Key): boolean {
    return key in this.store;
  }

  /**
   * Delete a key from the state (set to undefined)
   */
  public del<Key extends keyof State>(key: Key): this {
    return this.set(key, undefined);
  }

  /**
   * Push a value to an array in the state
   */
  public push<Key extends keyof OnlyArray<State>>(
    key: Key,
    value: NonNullable<State[Key]> extends Array<infer U> ? U : never,
  ): this {
    const current = (this.get(key) ?? []) as Array<any>; // default to empty array
    if (Array.isArray(current)) {
      this.set(key, [...current, value] as State[Key]);
    }
    return this;
  }

  /**
   * Clear all state
   */
  public clear(): this {
    this.store = {};
    return this;
  }

  /**
   * Get all keys that exist in the state
   */
  public keys(): (keyof State)[] {
    return Object.keys(this.store) as (keyof State)[];
  }
}

type OnlyArray<T extends object> = {
  [K in keyof T]: NonNullable<T[K]> extends Array<any> ? K : never;
};
