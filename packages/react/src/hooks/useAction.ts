import {
  DateTimeProvider,
  type DurationLike,
  type Interval,
  type Timeout,
} from "@alepha/datetime";
import {
  type DependencyList,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAlepha } from "./useAlepha.ts";
import { useInject } from "./useInject.ts";

/**
 * Hook for handling async actions with automatic error handling and event emission.
 *
 * By default, prevents concurrent executions - if an action is running and you call it again,
 * the second call will be ignored. Use `debounce` option to delay execution instead.
 *
 * Emits lifecycle events:
 * - `react:action:begin` - When action starts
 * - `react:action:success` - When action completes successfully
 * - `react:action:error` - When action throws an error
 * - `react:action:end` - Always emitted at the end
 *
 * @example Basic usage
 * ```tsx
 * const action = useAction({
 *   handler: async (data) => {
 *     await api.save(data);
 *   }
 * }, []);
 *
 * <button onClick={() => action.run(data)} disabled={action.loading}>
 *   Save
 * </button>
 * ```
 *
 * @example With debounce (search input)
 * ```tsx
 * const search = useAction({
 *   handler: async (query: string) => {
 *     await api.search(query);
 *   },
 *   debounce: 300 // Wait 300ms after last call
 * }, []);
 *
 * <input onChange={(e) => search.run(e.target.value)} />
 * ```
 *
 * @example Run on component mount
 * ```tsx
 * const fetchData = useAction({
 *   handler: async () => {
 *     const data = await api.getData();
 *     return data;
 *   },
 *   runOnInit: true // Runs once when component mounts
 * }, []);
 * ```
 *
 * @example Run periodically (polling)
 * ```tsx
 * const pollStatus = useAction({
 *   handler: async () => {
 *     const status = await api.getStatus();
 *     return status;
 *   },
 *   runEvery: 5000 // Run every 5 seconds
 * }, []);
 *
 * // Or with duration tuple
 * const pollStatus = useAction({
 *   handler: async () => {
 *     const status = await api.getStatus();
 *     return status;
 *   },
 *   runEvery: [30, 'seconds'] // Run every 30 seconds
 * }, []);
 * ```
 *
 * @example With AbortController
 * ```tsx
 * const fetch = useAction({
 *   handler: async (url, { signal }) => {
 *     const response = await fetch(url, { signal });
 *     return response.json();
 *   }
 * }, []);
 * // Automatically cancelled on unmount or when new request starts
 * ```
 *
 * @example With error handling
 * ```tsx
 * const deleteAction = useAction({
 *   handler: async (id: string) => {
 *     await api.delete(id);
 *   },
 *   onError: (error) => {
 *     if (error.code === 'NOT_FOUND') {
 *       // Custom error handling
 *     }
 *   }
 * }, []);
 *
 * {deleteAction.error && <div>Error: {deleteAction.error.message}</div>}
 * ```
 *
 * @example Global error handling
 * ```tsx
 * // In your root app setup
 * alepha.events.on("react:action:error", ({ error }) => {
 *   toast.danger(error.message);
 *   Sentry.captureException(error);
 * });
 * ```
 */
export function useAction<Args extends any[], Result = void>(
  options: UseActionOptions<Args, Result>,
  deps: DependencyList,
): UseActionReturn<Args, Result> {
  const alepha = useAlepha();
  const dateTimeProvider = useInject(DateTimeProvider);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const isExecutingRef = useRef(false);
  const debounceTimerRef = useRef<Timeout | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const isMountedRef = useRef(true);
  const intervalRef = useRef<Interval | undefined>(undefined);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;

      // clear debounce timer
      if (debounceTimerRef.current) {
        dateTimeProvider.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = undefined;
      }

      // clear interval
      if (intervalRef.current) {
        dateTimeProvider.clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }

      // abort in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = undefined;
      }
    };
  }, []);

  const executeAction = useCallback(
    async (...args: Args): Promise<Result | undefined> => {
      // Prevent concurrent executions
      if (isExecutingRef.current) {
        return;
      }

      // Abort previous request if still running
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      isExecutingRef.current = true;
      setLoading(true);
      setError(undefined);

      await alepha.events.emit("react:action:begin", {
        type: "custom",
        id: options.id,
      });

      try {
        // Pass abort signal as last argument to handler
        const result = await options.handler(...args, {
          signal: abortController.signal,
        } as any);

        // Only update state if still mounted and not aborted
        if (!isMountedRef.current || abortController.signal.aborted) {
          return;
        }

        await alepha.events.emit("react:action:success", {
          type: "custom",
          id: options.id,
        });

        if (options.onSuccess) {
          await options.onSuccess(result);
        }

        return result;
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        // Only update state if still mounted
        if (!isMountedRef.current) {
          return;
        }

        const error = err as Error;
        setError(error);

        await alepha.events.emit("react:action:error", {
          type: "custom",
          id: options.id,
          error,
        });

        if (options.onError) {
          await options.onError(error);
        } else {
          // Re-throw if no custom error handler
          throw error;
        }
      } finally {
        isExecutingRef.current = false;
        setLoading(false);

        await alepha.events.emit("react:action:end", {
          type: "custom",
          id: options.id,
        });

        // Clean up abort controller
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = undefined;
        }
      }
    },
    [...deps, options.id, options.onError, options.onSuccess],
  );

  const handler = useCallback(
    async (...args: Args): Promise<Result | undefined> => {
      if (options.debounce) {
        // clear existing timer
        if (debounceTimerRef.current) {
          dateTimeProvider.clearTimeout(debounceTimerRef.current);
        }

        // Set new timer
        return new Promise((resolve) => {
          debounceTimerRef.current = dateTimeProvider.createTimeout(
            async () => {
              const result = await executeAction(...args);
              resolve(result);
            },
            options.debounce ?? 0,
          );
        });
      }

      return executeAction(...args);
    },
    [executeAction, options.debounce],
  );

  const cancel = useCallback(() => {
    // clear debounce timer
    if (debounceTimerRef.current) {
      dateTimeProvider.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }

    // abort in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = undefined;
    }

    // reset state
    if (isMountedRef.current) {
      isExecutingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Run action on mount if runOnInit is true
  useEffect(() => {
    if (options.runOnInit) {
      handler(...([] as any));
    }
  }, deps);

  // Run action periodically if runEvery is specified
  useEffect(() => {
    if (!options.runEvery) {
      return;
    }

    // Set up interval
    intervalRef.current = dateTimeProvider.createInterval(
      () => handler(...([] as any)),
      options.runEvery,
      true,
    );

    // cleanup on unmount or when runEvery changes
    return () => {
      if (intervalRef.current) {
        dateTimeProvider.clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
    };
  }, [handler, options.runEvery]);

  return {
    run: handler,
    loading,
    error,
    cancel,
  };
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Context object passed as the last argument to action handlers.
 * Contains an AbortSignal that can be used to cancel the request.
 */
export interface ActionContext {
  /**
   * AbortSignal that can be passed to fetch or other async operations.
   * The signal will be aborted when:
   * - The component unmounts
   * - A new action is triggered (cancels previous)
   * - The cancel() method is called
   *
   * @example
   * ```tsx
   * const action = useAction({
   *   handler: async (url, { signal }) => {
   *     const response = await fetch(url, { signal });
   *     return response.json();
   *   }
   * }, []);
   * ```
   */
  signal: AbortSignal;
}

export interface UseActionOptions<Args extends any[] = any[], Result = any> {
  /**
   * The async action handler function.
   * Receives the action arguments plus an ActionContext as the last parameter.
   */
  handler: (...args: [...Args, ActionContext]) => Promise<Result>;

  /**
   * Custom error handler. If provided, prevents default error re-throw.
   */
  onError?: (error: Error) => void | Promise<void>;

  /**
   * Custom success handler.
   */
  onSuccess?: (result: Result) => void | Promise<void>;

  /**
   * Optional identifier for this action (useful for debugging/analytics)
   */
  id?: string;

  /**
   * Debounce delay in milliseconds. If specified, the action will only execute
   * after the specified delay has passed since the last call. Useful for search inputs
   * or other high-frequency events.
   *
   * @example
   * ```tsx
   * // Execute search 300ms after user stops typing
   * const search = useAction({ handler: search, debounce: 300 }, [])
   * ```
   */
  debounce?: number;

  /**
   * If true, the action will be executed once when the component mounts.
   *
   * @example
   * ```tsx
   * const fetchData = useAction({
   *   handler: async () => await api.getData(),
   *   runOnInit: true
   * }, []);
   * ```
   */
  runOnInit?: boolean;

  /**
   * If specified, the action will be executed periodically at the given interval.
   * The interval is specified as a DurationLike value (number in ms, Duration object, or [number, unit] tuple).
   *
   * @example
   * ```tsx
   * // Run every 5 seconds
   * const poll = useAction({
   *   handler: async () => await api.poll(),
   *   runEvery: 5000
   * }, []);
   * ```
   *
   * @example
   * ```tsx
   * // Run every 1 minute
   * const poll = useAction({
   *   handler: async () => await api.poll(),
   *   runEvery: [1, 'minute']
   * }, []);
   * ```
   */
  runEvery?: DurationLike;
}

export interface UseActionReturn<Args extends any[], Result> {
  /**
   * Execute the action with the provided arguments.
   *
   * @example
   * ```tsx
   * const action = useAction({ handler: async (data) => { ... } }, []);
   * action.run(data);
   * ```
   */
  run: (...args: Args) => Promise<Result | undefined>;

  /**
   * Loading state - true when action is executing.
   */
  loading: boolean;

  /**
   * Error state - contains error if action failed, undefined otherwise.
   */
  error?: Error;

  /**
   * Cancel any pending debounced action or abort the current in-flight request.
   *
   * @example
   * ```tsx
   * const action = useAction({ ... }, []);
   *
   * <button onClick={action.cancel} disabled={!action.loading}>
   *   Cancel
   * </button>
   * ```
   */
  cancel: () => void;
}
