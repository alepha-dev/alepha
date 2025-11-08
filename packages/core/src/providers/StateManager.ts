import type { TObject } from "typebox";
import type { State as AlephaState } from "../Alepha.ts";
import { Atom } from "../descriptors/$atom.ts";
import { $inject } from "../descriptors/$inject.ts";
import { AlsProvider } from "./AlsProvider.ts";
import { EventManager } from "./EventManager.ts";
import type { Static } from "./TypeProvider.ts";

export class StateManager<State extends object = AlephaState> {
  protected readonly als = $inject(AlsProvider);
  protected readonly events = $inject(EventManager);
  protected readonly atoms = new Map<keyof State, Atom>();

  protected store: Partial<State> = {};

  constructor(store: Partial<State> = {}) {
    this.store = store;
  }

  public register(atom: Atom): this {
    const key = atom.key as keyof State;
    if (!this.atoms.has(key)) {
      this.atoms.set(key, atom);
      this.store[key] = atom.options.default as State[typeof key];
    }
    return this;
  }

  /**
   * Get a value from the state with proper typing
   */
  public get<T extends TObject>(target: Atom<T>): Static<T>;
  public get<Key extends keyof State>(target: Key): State[Key] | undefined;
  public get(target: string | object): any {
    if (target instanceof Atom) {
      this.register(target);
    }

    const key = target instanceof Atom ? target.key : target;
    const store = this.store as Record<string, any>;

    if (this.als?.exists()) {
      return this.als.get(key as string) ?? store[key];
    }

    return store[key];
  }

  /**
   * Set a value in the state
   */
  public set<T extends TObject>(target: Atom<T>, value: Static<T>): this;
  public set<Key extends keyof State>(
    target: Key,
    value: State[Key] | undefined,
  ): this;
  public set(target: any, value: any): this {
    if (target instanceof Atom) {
      this.register(target);
    }

    const key = target instanceof Atom ? target.key : target;
    const store = this.store as Record<string, any>;

    const prevValue = this.get(key);
    if (prevValue === value) {
      return this;
    }

    if (this.als?.exists()) {
      this.als.set(key as string, value);
    } else {
      store[key] = value;
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
