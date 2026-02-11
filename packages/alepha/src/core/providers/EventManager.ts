import type { Hook, Hooks } from "../Alepha.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import type { Async } from "../interfaces/Async.ts";
import type { LoggerInterface } from "../interfaces/LoggerInterface.ts";

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
   * List of events that can be triggered. Powered by $hook().
   */
  protected events: Record<string, Array<Hook>> = {};

  /**
   * Cache of compiled executors, auto-built on first emit per event.
   */
  protected cache = new Map<string, CompiledEventExecutor<any>>();

  constructor(logFn?: () => LoggerInterface | undefined) {
    this.logFn = logFn;
  }

  protected get log(): LoggerInterface | undefined {
    return this.logFn?.();
  }

  public clear(): void {
    this.events = {};
    this.cache.clear();
  }

  /**
   * Registers a hook for the specified event.
   */
  public on<T extends keyof Hooks>(
    event: T,
    hookOrFunc: Hook<T> | ((payload: Hooks[T]) => Async<void>),
  ): () => void {
    if (!this.events[event]) {
      this.events[event] = [];
    }

    const hook =
      typeof hookOrFunc === "function" ? { callback: hookOrFunc } : hookOrFunc;

    // Insert hook respecting priority: "first" → front, "last" → back,
    // default → before any "last" hooks (preserves registration order)
    if (hook.priority === "first") {
      this.events[event].unshift(hook);
    } else if (hook.priority === "last") {
      this.events[event].push(hook);
    } else {
      const index = this.events[event].findIndex(
        (it) => it.priority === "last",
      );
      if (index !== -1) {
        this.events[event].splice(index, 0, hook);
      } else {
        this.events[event].push(hook);
      }
    }

    // Invalidate cached executors — hook list changed
    this.invalidateCache(event as string);

    return () => {
      this.events[event] = this.events[event].filter(
        (it) => it.callback !== hook.callback,
      );
      this.invalidateCache(event as string);
    };
  }

  protected invalidateCache(event: string): void {
    this.cache.delete(event);
    this.cache.delete(`${event}:catch`);
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
    const hooks = this.events[event];

    if (!hooks || hooks.length === 0) {
      return () => {};
    }

    const catchErrors = options.catch ?? false;
    const log = this.log;

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
                log?.error(
                  `${String(event)}(${hook.caller?.name ?? "unknown"}) ERROR`,
                  error,
                );
              });
            } else {
              await result;
            }
          }
        } catch (error) {
          if (catchErrors) {
            log?.error(
              `${String(event)}(${hook.caller?.name ?? "unknown"}) ERROR`,
              error,
            );
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
                  log?.error(
                    `${String(event)}(${hook.caller?.name ?? "unknown"}) ERROR`,
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
            log?.error(
              `${String(event)}(${hook.caller?.name ?? "unknown"}) ERROR`,
              error,
            );
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
    const events = this.events[event];
    if (!events || events.length === 0) return;

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
          this.log?.error(`${String(event)}(${name}) ERROR`, error);
          continue;
        }
        throw new AlephaError(
          `Failed during '${String(event)}()' hook for service: ${name}`,
          { cause: error },
        );
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
