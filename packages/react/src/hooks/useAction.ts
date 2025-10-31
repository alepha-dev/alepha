import { useCallback, useEffect, useRef, useState } from "react";
import { useAlepha } from "./useAlepha.ts";

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
 * const [handleSave, { loading, error }] = useAction({
 *   handler: async (data) => {
 *     await api.save(data);
 *   }
 * }, []);
 *
 * <button onClick={() => handleSave(data)} disabled={loading}>
 *   Save
 * </button>
 * ```
 *
 * @example With debounce (search input)
 * ```tsx
 * const [handleSearch] = useAction({
 *   handler: async (query: string) => {
 *     await api.search(query);
 *   },
 *   debounce: 300 // Wait 300ms after last call
 * }, []);
 *
 * <input onChange={(e) => handleSearch(e.target.value)} />
 * ```
 *
 * @example With AbortController
 * ```tsx
 * const [handleFetch] = useAction({
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
 * const [handleDelete] = useAction({
 *   handler: async (id: string) => {
 *     await api.delete(id);
 *   },
 *   onError: (error) => {
 *     if (error.code === 'NOT_FOUND') {
 *       // Custom error handling
 *     }
 *   }
 * }, []);
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
  deps: React.DependencyList,
): UseActionReturn<Args, Result> {
  const alepha = useAlepha();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isExecutingRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;

      // Clear debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      // Abort in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
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
      setError(null);

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
        // Only update state if still mounted
        if (isMountedRef.current) {
          isExecutingRef.current = false;
          setLoading(false);
        }

        await alepha.events.emit("react:action:end", {
          type: "custom",
          id: options.id,
        });

        // Clean up abort controller
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [...deps, options.id, options.onError, options.onSuccess],
  );

  const handler = useCallback(
    async (...args: Args): Promise<Result | undefined> => {
      if (options.debounce) {
        // Clear existing timer
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }

        // Set new timer
        return new Promise((resolve) => {
          debounceTimerRef.current = setTimeout(async () => {
            const result = await executeAction(...args);
            resolve(result);
          }, options.debounce);
        });
      }

      return executeAction(...args);
    },
    [executeAction, options.debounce],
  );

  const cancel = useCallback(() => {
    // Clear debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // Abort in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Reset state
    if (isMountedRef.current) {
      isExecutingRef.current = false;
      setLoading(false);
    }
  }, []);

  return [handler, { loading, error, cancel }];
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
   * useAction({
   *   handler: async (url, { signal }) => {
   *     const response = await fetch(url, { signal });
   *     return response.json();
   *   }
   * }, [])
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
   * useAction({ handler: search, debounce: 300 }, [])
   * ```
   */
  debounce?: number;
}

export type UseActionReturn<Args extends any[], Result> = [
  (...args: Args) => Promise<Result | undefined>,
  {
    loading: boolean;
    error: Error | null;
    /**
     * Cancel any pending debounced action or abort the current in-flight request.
     *
     * @example
     * ```tsx
     * const [handleFetch, { loading, cancel }] = useAction(...);
     *
     * <button onClick={cancel} disabled={!loading}>
     *   Cancel
     * </button>
     * ```
     */
    cancel: () => void;
  },
];
