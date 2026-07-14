import type { State as AlephaState } from "../Alepha.ts";
import type { LoggerInterface } from "../interfaces/LoggerInterface.ts";
import {
  Atom,
  type AtomStatic,
  type TAtomObject,
} from "../primitives/$atom.ts";
import { $inject } from "../primitives/$inject.ts";
import { AlsProvider, type StateScope } from "./AlsProvider.ts";
import { EventManager } from "./EventManager.ts";
import { JsonSchemaCodec } from "./JsonSchemaCodec.ts";
import { SchemaValidator } from "./SchemaValidator.ts";
import type { Static, TObject } from "./TypeProvider.ts";

export interface AtomWithValue {
  atom: Atom;
  value: unknown;
}

export class StateManager<State extends object = AlephaState> {
  protected readonly als = $inject(AlsProvider);
  protected readonly events = $inject(EventManager);
  protected readonly codec = $inject(JsonSchemaCodec);
  protected readonly validator = $inject(SchemaValidator);
  protected readonly atoms = new Map<keyof State, Atom>();

  protected store: Partial<State> = {};

  constructor(store: Partial<State> = {}) {
    this.store = store;
  }

  /**
   * Export all registered atoms as a plain object.
   *
   * @param scope - Controls which store layer to read from:
   *   - `undefined` (default): Resolved value (walks fork tree then app store).
   *   - `"current"`: Only the current ALS layer — intentionally does NOT walk
   *     the parent chain so that SSR serialisation captures exactly what the
   *     current request set, without leaking parent-fork state.
   *   - `"app"`: Only the root (app-level) store.
   */
  public exportAtoms(scope?: "current" | "app"): Record<string, unknown> {
    const exported: Record<string, unknown> = {};

    if (scope === "current") {
      if (this.als?.exists()) {
        for (const atom of this.atoms.values()) {
          const value = this.als.get(atom.key, "current");
          if (value !== undefined) {
            exported[atom.key as string] = value;
          }
        }
      }
      return exported;
    }

    for (const [key, atom] of this.atoms.entries()) {
      const value = this.get(atom, scope);
      if (value !== undefined) {
        exported[key as string] = value;
      }
    }

    return exported;
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

  /**
   * Return the registered atom for a state key, if any.
   */
  public getAtom(key: string): Atom | undefined {
    return this.atoms.get(key as keyof State);
  }

  public register(atom: Atom<any>): this {
    const key = atom.key as keyof State;

    if (this.atoms.has(key)) {
      return this;
    }

    this.atoms.set(key, atom);

    // A value can land under an atom's key before the atom registers — an
    // SSR hydration payload, an `Alepha.create(seed)` value, or a
    // fork-scoped write (e.g. `$cookie` mirrors its value into the store
    // during `server:onRequest`, ahead of the atom's first access). `get()`
    // resolves ALS (request-scoped fork) layers before the app store, so we
    // must look there first too — decoding only `this.store` would let a
    // raw, unvalidated ALS value permanently shadow the decoded default.
    const layer = this.als?.getLayer(key as string);
    if (layer) {
      this.decodeExisting(atom, key, layer);
    } else if (key in this.store) {
      this.decodeExisting(atom, key, this.store as Record<string, any>);
    } else {
      this.set(key, atom.options.default as State[keyof State], {
        skipContext: true,
      });
    }

    this.bindWebStorage(atom);

    this.events
      ?.emit("state:register", { atom }, { catch: true })
      .catch(() => null);

    return this;
  }

  /**
   * Decode a value that already exists under an atom's key at registration
   * time, in place, in whichever layer it physically lives (an ALS fork
   * layer or the app store) — never flattening a fork-scoped value into the
   * app-level store.
   *
   * On schema mismatch, falls back to the atom's default (written into that
   * same layer) and emits a warning: a bad seed silently reverting a whole
   * atom to its defaults should be visible, not indistinguishable from
   * "nothing was ever set".
   */
  protected decodeExisting(
    atom: Atom<any>,
    key: keyof State,
    layer: Record<string, any>,
  ): void {
    const current = layer[key as string];
    if (current === undefined) {
      return;
    }

    const result = this.validator.safeValidate(atom.schema, current);
    if (result.success) {
      layer[key as string] = result.data;
      return;
    }

    this.logger?.warn(
      `Atom "${String(key)}" received an invalid seed value at registration, falling back to its default.`,
      { issues: result.error.issues },
    );
    layer[key as string] = atom.options.default;
  }

  /**
   * Web-storage persistence (localStorage / sessionStorage) for atoms
   * declared with `persist`. Best-effort: quota errors and privacy modes
   * are swallowed. Cookie persistence is NOT handled here — it needs the
   * HTTP request cycle and lives in `alepha/server/cookies`
   * (AtomCookiePersistence), wired through the `state:register` event.
   */
  protected bindWebStorage(atom: Atom<any>): void {
    const persist = atom.options.persist;
    if (persist !== "localStorage" && persist !== "sessionStorage") {
      return;
    }

    const storage = this.getWebStorage(persist);
    if (!storage) {
      // Server side: web storage does not exist, so an SSR'd page cannot
      // render the persisted value. SSR apps must use `persist: "cookie"`.
      this.logger?.warn(
        `Atom "${atom.key}" uses ${persist} persistence, which is unavailable in this environment. Use persist: "cookie" for SSR apps.`,
      );
      return;
    }

    const key = atom.key as keyof State;

    try {
      const raw = storage.getItem(atom.key);
      if (raw != null) {
        const result = this.validator.safeValidate(
          atom.schema,
          JSON.parse(raw),
        );
        if (result.success) {
          // Persisted user state wins over the default and over any seed.
          this.store[key] = result.data as State[keyof State];
        } else {
          storage.removeItem(atom.key);
        }
      }
    } catch {
      storage.removeItem(atom.key);
    }

    this.events.on("state:mutate", ({ key: mutatedKey, value }) => {
      if (mutatedKey !== atom.key) {
        return;
      }
      try {
        if (value === undefined) {
          storage.removeItem(atom.key);
        } else {
          storage.setItem(atom.key, JSON.stringify(value));
        }
      } catch {
        // best-effort persistence
      }
    });
  }

  /**
   * Resolve a Web Storage area, or undefined when unavailable (server,
   * privacy mode that throws on access).
   */
  protected getWebStorage(
    kind: "localStorage" | "sessionStorage",
  ): Storage | undefined {
    try {
      if (typeof window === "undefined") {
        return undefined;
      }
      return kind === "localStorage"
        ? window.localStorage
        : window.sessionStorage;
    } catch {
      return undefined;
    }
  }

  /**
   * Best-effort logger lookup. `StateManager` lives in `core`, which cannot
   * depend on the logger module, so this reads the `"alepha.logger"` state
   * key directly (set by `Alepha.create()`, see `Alepha.ts`) instead of
   * injecting a logger service. May be `undefined` during early boot, before
   * the logger is wired up — callers must stay null-safe.
   */
  protected get logger(): LoggerInterface | undefined {
    return this.get("alepha.logger" as keyof State) as
      | LoggerInterface
      | undefined;
  }

  /**
   * Get a value from the state with proper typing.
   *
   * @param scope - Optional scope to control resolution:
   *   - `undefined` (default): Walk up the fork tree from current layer to root, then fall back to the app store.
   *   - `"current"`: Read only from the current fork layer (no tree walking).
   *   - `"parent"`: Read only from the immediate parent fork layer.
   *   - `"app"`: Read only from the root (app-level) store.
   */
  public get<T extends TAtomObject>(
    target: Atom<T>,
    scope?: StateScope,
  ): Static<T>;
  public get<Key extends keyof State>(
    target: Key,
    scope?: StateScope,
  ): State[Key] | undefined;
  public get(target: string | object, scope?: StateScope): any {
    if (target instanceof Atom) {
      this.register(target);
    }

    const key = target instanceof Atom ? target.key : target;
    const store = this.store as Record<string, any>;

    if (scope === "app") {
      return store[key];
    }

    return this.als?.exists()
      ? (this.als.get(key as string, scope) ?? (scope ? undefined : store[key]))
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

    const atom =
      target instanceof Atom ? target : this.atoms.get(key as keyof State);
    if (atom && value !== undefined && options?.skipValidation !== true) {
      value = this.validator.validate(atom.schema, value);
    }

    const prevValue = this.get(key);
    if (prevValue === value && typeof value !== "object") {
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
   * Check if a key exists in the state.
   * Walks the ALS fork tree when inside a fork context.
   */
  public has<Key extends keyof State>(key: Key): boolean {
    if (this.als?.has(key as string)) {
      return true;
    }
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

  /**
   * Skip schema validation for this write. Internal escape hatch for
   * callers that have already validated the value (e.g. hydration).
   */
  skipValidation?: boolean;
}
