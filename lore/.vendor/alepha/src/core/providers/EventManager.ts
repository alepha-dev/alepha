import type { Hook, Hooks } from "../Alepha.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import type { Async } from "../interfaces/Async.ts";
import type { LoggerInterface } from "../interfaces/LoggerInterface.ts";
import type { Service } from "../interfaces/Service.ts";

/**
 * Compiled event executor - optimized for hot paths.
 * Returns void for sync-only chains, Promise<void> for chains with async hooks.
 */
export type CompiledEventExecutor<T extends keyof Hooks> = (
  payload: Hooks[T],
) => void | Promise<void>;

/**
 * Options for compiled event executors.
 */
export interface CompileOptions {
  /**
   * If true, errors will be caught and logged instead of throwing.
   * @default false
   */
  catch?: boolean;
}

export class EventManager {
  public logFn?: () => LoggerInterface | undefined;

  /**
   * Three-list storage for hooks, split by priority tier.
   */
  protected events: Record<
    string,
    { first: Array<Hook>; normal: Array<Hook>; last: Array<Hook> }
  > = {};

  /**
   * Cache of compiled executors, auto-built on first emit per event.
   */
  protected cache = new Map<string, CompiledEventExecutor<any>>();

  /**
   * Cache of resolved (topo-sorted) hook arrays per event.
   */
  protected sortedCache = new Map<string, Array<Hook>>();

  protected get log(): LoggerInterface | undefined {
    return this.logFn?.();
  }

  public clear(): void {
    this.events = {};
    this.cache.clear();
    this.sortedCache.clear();
  }

  /**
   * Registers a hook for the specified event.
   */
  public on<T extends keyof Hooks>(
    event: T,
    hookOrFunc: Hook<T> | ((payload: Hooks[T]) => Async<void>),
  ): () => void {
    if (!this.events[event]) {
      this.events[event] = { first: [], normal: [], last: [] };
    }

    const hook =
      typeof hookOrFunc === "function" ? { callback: hookOrFunc } : hookOrFunc;

    const lists = this.events[event];

    if (hook.priority === "first") {
      lists.first.push(hook);
    } else if (hook.priority === "last") {
      lists.last.push(hook);
    } else {
      lists.normal.push(hook);
    }

    this.invalidateCache(event as string);

    return () => {
      const lists = this.events[event];
      if (!lists) return;
      for (const key of ["first", "normal", "last"] as const) {
        // Remove by hook identity, not callback identity: two subscriptions
        // sharing one callback function are distinct registrations, and
        // unsubscribing one must not silently remove the other.
        lists[key] = lists[key].filter((it) => it !== hook);
      }
      this.invalidateCache(event as string);
    };
  }

  protected invalidateCache(event: string): void {
    this.cache.delete(event);
    this.cache.delete(`${event}:catch`);
    this.sortedCache.delete(event);
  }

  /**
   * Resolves the final ordered hook list for an event.
   * Applies topological sort (Kahn's algorithm) within each priority tier
   * based on before/after constraints.
   */
  protected resolve(event: string): Array<Hook> {
    const cached = this.sortedCache.get(event);
    if (cached) return cached;

    const lists = this.events[event];
    if (!lists) return [];

    const sorted = [
      ...this.topoSort(lists.first),
      ...this.topoSort(lists.normal),
      ...this.topoSort(lists.last),
    ];

    this.sortedCache.set(event, sorted);
    return sorted;
  }

  /**
   * Topological sort using Kahn's algorithm.
   * Hooks with no constraints maintain registration order (stable).
   */
  protected topoSort(hooks: Array<Hook>): Array<Hook> {
    if (hooks.length <= 1) return hooks;

    // Check if any hook has constraints — skip sort if none
    const hasConstraints = hooks.some(
      (h) =>
        (h.before && h.before.length > 0) || (h.after && h.after.length > 0),
    );
    if (!hasConstraints) return hooks;

    // Build adjacency: edge from A → B means A must run before B
    const inDegree = new Map<Hook, number>();
    const adjacency = new Map<Hook, Set<Hook>>();

    for (const hook of hooks) {
      inDegree.set(hook, 0);
      adjacency.set(hook, new Set());
    }

    // Build a map from service class → hooks in this list owned by that service
    const serviceToHooks = new Map<Service, Array<Hook>>();
    for (const hook of hooks) {
      if (hook.caller) {
        let arr = serviceToHooks.get(hook.caller);
        if (!arr) {
          arr = [];
          serviceToHooks.set(hook.caller, arr);
        }
        arr.push(hook);
      }
    }

    // "after: [ServiceA]" means this hook runs after ServiceA's hooks → edge from ServiceA's hooks → this hook
    for (const hook of hooks) {
      if (hook.after) {
        for (const dep of hook.after) {
          const depHooks = serviceToHooks.get(dep);
          if (depHooks) {
            for (const depHook of depHooks) {
              if (depHook !== hook && !adjacency.get(depHook)!.has(hook)) {
                adjacency.get(depHook)!.add(hook);
                inDegree.set(hook, inDegree.get(hook)! + 1);
              }
            }
          }
        }
      }

      // "before: [ServiceB]" means this hook runs before ServiceB's hooks → edge from this hook → ServiceB's hooks
      if (hook.before) {
        for (const dep of hook.before) {
          const depHooks = serviceToHooks.get(dep);
          if (depHooks) {
            for (const depHook of depHooks) {
              if (depHook !== hook && !adjacency.get(hook)!.has(depHook)) {
                adjacency.get(hook)!.add(depHook);
                inDegree.set(depHook, inDegree.get(depHook)! + 1);
              }
            }
          }
        }
      }
    }

    // Kahn's algorithm with stable ordering (registration order as tiebreaker)
    const queue: Array<Hook> = [];
    for (const hook of hooks) {
      if (inDegree.get(hook)! === 0) {
        queue.push(hook);
      }
    }

    const result: Array<Hook> = [];
    while (queue.length > 0) {
      const hook = queue.shift()!;
      result.push(hook);

      for (const neighbor of adjacency.get(hook)!) {
        const deg = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (result.length !== hooks.length) {
      throw new AlephaError(
        "Circular dependency detected in hook before/after constraints",
      );
    }

    return result;
  }

  /**
   * Compiles an event into an optimized executor function.
   *
   * Called automatically by emit() on first use. Can also be called
   * manually for direct access to the executor.
   */
  public compile<T extends keyof Hooks>(
    event: T,
    options: CompileOptions = {},
  ): CompiledEventExecutor<T> {
    const hooks = this.resolve(event as string);

    if (hooks.length === 0) {
      return () => {};
    }

    const catchErrors = options.catch ?? false;

    // Once the first async hook is encountered, all remaining hooks
    // must run in this async continuation to preserve sequential ordering
    const runRemainingAsync = async (
      startIndex: number,
      payload: Hooks[T],
    ): Promise<void> => {
      for (let i = startIndex; i < hooks.length; i++) {
        const hook = hooks[i];
        try {
          const result = hook.callback(payload);
          if (result && typeof result === "object" && "then" in result) {
            if (catchErrors) {
              await (result as Promise<void>).catch((error) => {
                this.reportListenerError(
                  String(event),
                  hook.caller?.name,
                  error,
                );
              });
            } else {
              await result;
            }
          }
        } catch (error) {
          if (catchErrors) {
            this.reportListenerError(String(event), hook.caller?.name, error);
          } else {
            throw error;
          }
        }
      }
    };

    // Run sync hooks synchronously. On first async hook, switch to
    // runRemainingAsync and return the Promise. If all hooks are sync,
    // returns void (no Promise allocation).
    return (payload: Hooks[T]): void | Promise<void> => {
      for (let i = 0; i < hooks.length; i++) {
        const hook = hooks[i];
        try {
          const result = hook.callback(payload);
          if (result && typeof result === "object" && "then" in result) {
            if (catchErrors) {
              return (result as Promise<void>)
                .catch((error) => {
                  this.reportListenerError(
                    String(event),
                    hook.caller?.name,
                    error,
                  );
                })
                .then(() => runRemainingAsync(i + 1, payload));
            }
            return (result as Promise<void>).then(() =>
              runRemainingAsync(i + 1, payload),
            );
          }
        } catch (error) {
          if (catchErrors) {
            this.reportListenerError(String(event), hook.caller?.name, error);
          } else {
            throw error;
          }
        }
      }
    };
  }

  /**
   * Emits the specified event with the given payload.
   *
   * Auto-compiles and caches an optimized executor on first call per event.
   * Use `{ log: true }` for startup events that need timing information.
   */
  /**
   * Report a listener that threw, without feeding the failure back into the
   * event it came from.
   *
   * A `log` listener that threw used to be reported through the logger, and
   * the logger's own emit dispatches `log` again - so the same listener threw
   * again, and again, until the stack ran out. One misbehaving devtools or
   * telemetry subscriber took the process down on the first log line after it
   * registered.
   *
   * `console.error` loses nothing here: the logger writes to its destination
   * independently of the event, so the failing entry has already been printed.
   * Only the second dispatch is dropped, which is the loop.
   */
  protected reportListenerError(
    event: string,
    caller: string | undefined,
    error: unknown,
  ): void {
    const message = `${event}(${caller ?? "unknown"}) ERROR`;
    if (event === "log") {
      console.error(message, error);
      return;
    }
    this.log?.error(message, error);
  }

  public async emit<T extends keyof Hooks>(
    event: T,
    payload: Hooks[T],
    options: {
      /**
       * If true, the hooks will be logged with their execution time.
       *
       * @default false
       */
      log?: boolean;
      /**
       * If true, errors will be caught and logged instead of throwing.
       *
       * @default false
       */
      catch?: boolean;
    } = {},
  ): Promise<void> {
    // Fast path: auto-compiled executor
    if (!options.log) {
      const cacheKey = options.catch
        ? `${event as string}:catch`
        : (event as string);
      let executor = this.cache.get(cacheKey);
      if (!executor) {
        executor = this.compile(event, { catch: options.catch });
        this.cache.set(cacheKey, executor);
      }
      await executor(payload);
      return;
    }

    // Slow path with logging (startup only)
    const events = this.resolve(event as string);
    if (events.length === 0) return;

    const now = performance.now();
    this.log?.trace(`${String(event)} ...`);

    for (const hook of events) {
      const name = hook.caller?.name ?? "unknown";
      const hookStart = performance.now();
      this.log?.trace(`${String(event)}(${name}) ...`);

      try {
        const result = hook.callback(payload);
        if (result && typeof result === "object" && "then" in result) {
          await result;
        }
      } catch (error) {
        if (options.catch) {
          this.reportListenerError(String(event), name, error);
          continue;
        }
        // Rethrown as it was thrown. This used to wrap, so a hook failing
        // during `start()` (which logs) surfaced an `AlephaError` while the
        // SAME hook failing on any other emit surfaced its own error: an
        // `instanceof` check on a hook failure answered differently depending
        // on a logging option, and an application's `ConflictError` lost both
        // its status and its message on the way out.
        //
        // The context the wrapper carried is not lost - it is logged, right
        // here, which is where a human looks for it. It is deliberately not
        // stamped onto the error as a property: nothing reads such a
        // property, and an error's shape is the caller's contract.
        this.log?.error(
          `Failed during '${String(event)}()' hook for service: ${name}`,
          error,
        );
        throw error;
      }

      this.log?.debug(
        `${String(event)}(${name}) OK [${(performance.now() - hookStart).toFixed(1)}ms]`,
      );
    }

    this.log?.debug(
      `${String(event)} OK [${(performance.now() - now).toFixed(1)}ms]`,
    );
  }
}
