import { AbortedError } from "../errors/AbortedError.ts";
import { TimeoutError } from "../errors/TimeoutError.ts";

export type AsyncLocalStorageData = Record<string, unknown>;

type ContextLayer = AsyncLocalStorageData & {
  [ALS_PARENT]?: ContextLayer;
  [ALS_NESTED]?: boolean;
};

/**
 * The runtime adapter needed by the container, independent of Node types.
 */
interface ContextStorage {
  getStore(): ContextLayer | undefined;
  run<R>(store: ContextLayer, callback: () => R): R;
}

/**
 * Which layers a read resolves through.
 *
 * - `undefined`: every layer up to the root, then the app store.
 * - `"current"`: the innermost layer only.
 * - `"fork"`: the innermost layer {@link AlsProvider.run} opened, reading
 *   through any {@link AlsProvider.nest} layers above it. What a value
 *   published on a unit of work (an action's request) needs: a nested layer
 *   is the same unit of work, while an outer `run()` is a different one.
 * - `"parent"`: the immediate parent layer only.
 * - `"app"`: the app-level store only.
 */
export type StateScope = "current" | "fork" | "app" | "parent";

export const ALS_PARENT = Symbol("als.parent");

/**
 * Marks a layer {@link AlsProvider.nest} opened, so a `"fork"` read knows it
 * may read through it to the `run()` layer beneath.
 */
export const ALS_NESTED = Symbol("als.nested");

export class AlsProvider {
  static create = (): ContextStorage | undefined => {
    return undefined;
  };

  public als?: ContextStorage;

  constructor() {
    this.als = AlsProvider.create();
  }

  public createContextId(): string {
    return crypto.randomUUID();
  }

  public run<R>(callback: () => R, data: Record<string, unknown> = {}): R {
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
   * Run `callback` in a fresh root context: like {@link run}, but with no
   * parent, so nothing the caller's context holds is visible inside.
   *
   * For work that must not see the request it was started from, such as the
   * page cache's anonymous re-render of a page (#E78): reading through to the
   * caller would hand it the visitor's user and cookies.
   */
  public runIsolated<R>(
    callback: () => R,
    data: Record<string, unknown> = {},
  ): R {
    if (!this.als) {
      return callback();
    }

    data.registry ??= new Map();
    data.context ??= this.createContextId();

    return this.als.run({ ...data }, callback);
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
    const layer: ContextLayer = {
      [ALS_PARENT]: parent,
      [ALS_NESTED]: true,
    };

    if (!parent) {
      layer.context = this.createContextId();
    }

    return this.als.run(layer, callback);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Ambient cancellation (#E85)
  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The app's own controller, aborted when `alepha.stop()` begins.
   *
   * One per container. A unit of work (a request, a job run) never composes
   * with it: its owner drains on stop and aborts its units at its own
   * deadline, so composing it in would turn a graceful drain into a kill.
   */
  protected appController = new AbortController();

  /**
   * The app signal: aborted when `alepha.stop()` begins, never `undefined`.
   *
   * What {@link signal} answers outside any unit of work, in an isolated
   * context, under {@link detachSignal}, and in browser builds.
   */
  public get appSignal(): AbortSignal {
    return this.appController.signal;
  }

  /**
   * Abort the app signal. Called by `alepha.stop()` as it begins.
   */
  public abortApp(reason?: unknown): void {
    if (!this.appController.signal.aborted) {
      this.appController.abort(reason);
    }
  }

  /**
   * Give the app a fresh signal when the previous one was aborted, so a
   * container started again after a `stop()` does not begin life cancelled.
   */
  public renewApp(): void {
    if (this.appController.signal.aborted) {
      this.appController = new AbortController();
    }
  }

  /**
   * The ambient signal of the current unit of work: a request's (aborted on
   * client disconnect), a job run's, an MCP tool call's.
   *
   * Reads the innermost layer holding a `signal`, walking up like every
   * other key, and falls back to {@link appSignal}. Never `undefined`, so a
   * consumer can always pass it on:
   *
   * ```ts
   * for (const item of items) {
   *   alepha.context.signal.throwIfAborted();
   *   await process(item);
   * }
   * ```
   */
  public get signal(): AbortSignal {
    return this.get<AbortSignal>("signal") ?? this.appSignal;
  }

  /**
   * Run `callback` under a signal that aborts when either the current one or
   * `signal` does. It can only narrow the ambient signal, never widen it.
   *
   * With no ALS (browser builds) this is `callback()`.
   */
  public withSignal<R>(signal: AbortSignal, callback: () => R): R {
    if (!this.als) {
      return callback();
    }

    const current = this.signal;
    const combined =
      current === signal ? signal : AbortSignal.any([current, signal]);
    return this.nestWith({ signal: combined }, callback);
  }

  /**
   * Run `callback` under the app signal instead of the current one: the
   * opt-out for work that must finish after the client left, such as a
   * fire-and-forget write.
   *
   * Detached work still dies at app stop. Work that must survive a shutdown
   * belongs in a `$job`.
   *
   * With no ALS (browser builds) this is `callback()`.
   */
  public detachSignal<R>(callback: () => R): R {
    if (!this.als) {
      return callback();
    }

    return this.nestWith({ signal: this.appSignal }, callback);
  }

  /**
   * Whether `error` is an abort rather than a failure: the error is the
   * `reason` of `signal` (the ambient one when omitted) once it aborted, or
   * an {@link AbortedError}, or a `DOMException` named `AbortError`. Checks
   * the error's `cause` too, for a consumer that wrapped the abort.
   *
   * Every consumer classifies an abort through this, so a disconnect is
   * never reported as an error anywhere.
   *
   * A {@link TimeoutError} is never an abort, even as the signal's reason: a
   * deadline that fired is a failure to report (#E87).
   */
  public isAbortError(error: unknown, signal?: AbortSignal): boolean {
    const target = signal ?? this.signal;
    let current: unknown = error;
    for (let depth = 0; depth < 3 && current != null; depth++) {
      if (current instanceof TimeoutError) {
        return false;
      }
      if (target.aborted && current === target.reason) {
        return true;
      }
      if (current instanceof AbortedError) {
        return true;
      }
      if (
        typeof current === "object" &&
        (current as { name?: unknown }).name === "AbortError"
      ) {
        return true;
      }
      current = (current as { cause?: unknown }).cause;
    }
    return false;
  }

  /**
   * {@link nest}, with `data` written into the new layer.
   */
  protected nestWith<R>(data: AsyncLocalStorageData, callback: () => R): R {
    return this.nest(() => {
      for (const key of Object.keys(data)) {
        this.set(key, data[key]);
      }
      return callback();
    });
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

    if (scope === "fork") {
      return this.forkLayerOf(store, key)?.[key] as T | undefined;
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
   * The layer holding `key` for a `"fork"` read: the current layer, or one
   * beneath it reached only through {@link nest} layers. The walk stops at
   * the first layer `run()` opened, so a value an OUTER unit of work
   * published (an enclosing action's request) is never answered for this one.
   */
  protected forkLayerOf(
    store: ContextLayer,
    key: string,
  ): AsyncLocalStorageData | undefined {
    let layer: ContextLayer | undefined = store;
    while (layer) {
      if (key in layer) {
        return layer;
      }
      if (!layer[ALS_NESTED]) {
        return undefined;
      }
      layer = layer[ALS_PARENT];
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

    if (scope === "fork") {
      return !!this.forkLayerOf(store, key);
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
