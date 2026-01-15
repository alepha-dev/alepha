import type { Hook, Hooks } from "../Alepha.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import type { Async } from "../interfaces/Async.ts";
import type { LoggerInterface } from "../interfaces/LoggerInterface.ts";

/**
 * Compiled event executor - optimized for hot paths.
 * Returns void for sync-only chains, Promise<void> for chains with async hooks.
 */
export type CompiledEventExecutor<T> = (payload: T) => void | Promise<void>;

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

  constructor(logFn?: () => LoggerInterface | undefined) {
    this.logFn = logFn;
  }

  protected get log(): LoggerInterface | undefined {
    return this.logFn?.();
  }

  public clear(): void {
    this.events = {};
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

    return () => {
      this.events[event] = this.events[event].filter(
        (it) => it.callback !== hook.callback,
      );
    };
  }

  /**
   * Compiles an event into an optimized executor function.
   *
   * Call this after all hooks are registered (e.g., after Alepha.start()).
   * The returned function checks each hook's return value and awaits promises.
   * Returns undefined if all hooks are sync, or a Promise if any hook returns one.
   *
   * @example
   * ```ts
   * // At startup (after hooks are registered)
   * const onRequest = alepha.events.compile("server:onRequest", { catch: true });
   *
   * // In hot path - only await if promise returned
   * const result = onRequest({ request, route });
   * if (result) await result;
   * ```
   */
  public compile<T extends keyof Hooks>(
    event: T,
    options: CompileOptions = {},
  ): CompiledEventExecutor<Hooks[T]> {
    const hooks = this.events[event];

    // No hooks - return no-op
    if (!hooks || hooks.length === 0) {
      return () => {};
    }

    const catchErrors = options.catch ?? false;
    const log = this.log;

    // Helper to run remaining hooks sequentially after first async hook
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

    // Return executor that runs sync hooks synchronously, then switches to async
    // when encountering the first async hook. Returns void if all sync.
    return (payload: Hooks[T]): void | Promise<void> => {
      for (let i = 0; i < hooks.length; i++) {
        const hook = hooks[i];
        try {
          const result = hook.callback(payload);
          if (result && typeof result === "object" && "then" in result) {
            // Hit an async hook - await it and continue remaining hooks async
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
      // All hooks were sync - return void
    };
  }

  /**
   * Emits the specified event with the given payload.
   *
   * For hot paths (like HTTP request handling), use compile() instead
   * to get an optimized executor.
   */
  public async emit<T extends keyof Hooks>(
    func: T,
    payload: Hooks[T],
    options: {
      /**
       * If true, the hooks will be executed in reverse order.
       * This is useful for "stop" hooks that should be executed in reverse order.
       *
       * @default false
       */
      reverse?: boolean;
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
    // Fast path: no listeners for this event
    const events = this.events[func];
    if (!events || events.length === 0) {
      return;
    }

    // Fast path: single listener, no logging, no reverse
    if (events.length === 1 && !options.log && !options.reverse) {
      const hook = events[0];
      try {
        const result = hook.callback(payload);
        if (result && typeof result === "object" && "then" in result) {
          await result;
        }
      } catch (error) {
        if (options.catch) {
          this.log?.error(
            `${String(func)}(${hook.caller?.name ?? "unknown"}) ERROR`,
            error,
          );
          return;
        }
        throw error;
      }
      return;
    }

    const ctx: any = {};

    if (options.log) {
      ctx.now = performance.now();
      this.log?.trace(`${String(func)} ...`);
    }

    let eventList = events;
    if (options.reverse) {
      eventList = events.toReversed();
    }

    for (const hook of eventList) {
      const name = hook.caller?.name ?? "unknown";
      if (options.log) {
        ctx.now2 = performance.now();
        this.log?.trace(`${String(func)}(${name}) ...`);
      }

      try {
        const result = hook.callback(payload);
        if (result && typeof result === "object" && "then" in result) {
          await result;
        }
      } catch (error) {
        if (options.catch) {
          this.log?.error(`${String(func)}(${name}) ERROR`, error);
          continue;
        }
        if (options.log) {
          throw new AlephaError(
            `Failed during '${String(func)}()' hook for service: ${name}`,
            { cause: error },
          );
        }
        throw error;
      }

      if (options.log) {
        this.log?.debug(
          `${String(func)}(${name}) OK [${(performance.now() - ctx.now2).toFixed(1)}ms]`,
        );
      }
    }

    if (options.log) {
      this.log?.debug(
        `${String(func)} OK [${(performance.now() - ctx.now).toFixed(1)}ms]`,
      );
    }
  }
}
