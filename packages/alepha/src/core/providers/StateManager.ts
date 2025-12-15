import type { TObject } from "typebox";
import type { State as AlephaState } from "../Alepha.ts";
import {
  Atom,
  type AtomStatic,
  type TAtomObject,
} from "../primitives/$atom.ts";
import { $inject } from "../primitives/$inject.ts";
import { AlsProvider } from "./AlsProvider.ts";
import { EventManager } from "./EventManager.ts";
import { JsonSchemaCodec } from "./JsonSchemaCodec.ts";
import type { Static } from "./TypeProvider.ts";

export interface AtomWithValue {
  atom: Atom;
  value: unknown;
}

export class StateManager<State extends object = AlephaState> {
  protected readonly als = $inject(AlsProvider);
  protected readonly events = $inject(EventManager);
  protected readonly codec = $inject(JsonSchemaCodec);
  protected readonly atoms = new Map<keyof State, Atom>();

  protected store: Partial<State> = {};

  constructor(store: Partial<State> = {}) {
    this.store = store;
  }

  public getAtoms(context = true): Array<AtomWithValue> {
    const atoms: Array<AtomWithValue> = [];

    if (context && this.als?.exists()) {
      // for each this.atoms, check if key is present in als, if yes, add to new map
      for (const atom of this.atoms.values()) {
        const value = this.als.get(atom.key);
        if (value !== undefined) {
          atoms.push({ atom, value });
        }
      }
    } else {
      for (const [key, atom] of this.atoms.entries()) {
        atoms.push({ atom, value: this.store[key] as unknown });
      }
    }

    return atoms;
  }

  public register(atom: Atom<any>): this {
    const key = atom.key as keyof State;

    if (!this.atoms.has(key)) {
      this.atoms.set(key, atom);
      if (!(key in this.store)) {
        this.set(key, atom.options.default as State[keyof State], {
          skipContext: true,
        });
      }
    }

    return this;
  }

  /**
   * Get a value from the state with proper typing
   */
  public get<T extends TAtomObject>(target: Atom<T>): Static<T>;
  public get<Key extends keyof State>(target: Key): State[Key] | undefined;
  public get(target: string | object): any {
    if (target instanceof Atom) {
      this.register(target);
    }

    const key = target instanceof Atom ? target.key : target;
    const store = this.store as Record<string, any>;

    return this.als?.exists()
      ? (this.als.get(key as string) ?? store[key])
      : store[key];
  }

  /**
   * Set a value in the state
   */
  public set<T extends TAtomObject>(
    target: Atom<T>,
    value: AtomStatic<T>,
    options?: SetStateOptions,
  ): this;
  public set<Key extends keyof State>(
    target: Key,
    value: State[Key] | undefined,
    options?: SetStateOptions,
  ): this;
  public set(target: any, value: any, options?: SetStateOptions): this {
    if (target instanceof Atom) {
      this.register(target);
    }

    const key = target instanceof Atom ? target.key : target;
    const store = this.store as Record<string, any>;

    const prevValue = this.get(key);
    if (prevValue === value) {
      return this;
    }

    if (options?.skipContext !== true && this.als?.exists()) {
      this.als.set(key as string, value);
    } else {
      store[key] = value;
    }

    if (options?.skipEvents !== true) {
      this.events
        ?.emit(
          "state:mutate",
          { key: key as keyof AlephaState, value, prevValue },
          { catch: true },
        )
        .catch(() => null);
    }

    return this;
  }

  /**
   * Mutate a value in the state.
   */
  public mut<T extends TObject>(
    target: Atom<T>,
    mutator: (current: Static<T>) => Static<T>,
  ): this;
  public mut<Key extends keyof State>(
    target: Key,
    mutator: (current: State[Key] | undefined) => State[Key] | undefined,
  ): this;
  public mut(target: any, mutator: (current: any) => any): this {
    const current = this.get(target);
    const updated = mutator(current);
    return this.set(target, updated);
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
    ...value: Array<NonNullable<State[Key]> extends Array<infer U> ? U : never>
  ): this {
    const current = (this.get(key) ?? []) as Array<any>; // default to empty array
    if (Array.isArray(current)) {
      this.set(key, [...current, ...value] as State[Key]);
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

export interface SetStateOptions {
  skipContext?: boolean;
  skipEvents?: boolean;
}
