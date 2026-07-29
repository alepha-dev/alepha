import type { Async } from "alepha";
import {
  DateTimeProvider,
  type DurationLike,
  type Interval,
  type Timeout,
} from "alepha/datetime";
import {
  type DependencyList,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { QueryCache } from "../services/QueryCache.ts";
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
  const [result, setResult] = useState<Result | undefined>();
  const isExecutingRef = useRef(false);
  const debounceTimerRef = useRef<Timeout | undefined>(undefined);
  /** Resolves the promise handed to a debounced caller that got superseded. */
  const pendingDebounce = useRef<(() => void) | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const isMountedRef = useRef(true);
  const intervalRef = useRef<Interval | undefined>(undefined);
  // Monotonic id of the latest run. A superseded run keeps executing until its
  // abort lands, so every state write is gated on "am I still the latest?" —
  // otherwise the stale run's `finally` would clear the newer run's `loading`.
  const runIdRef = useRef(0);

  // Track mount state — must set true in body for React StrictMode double-invoke
  useEffect(() => {
    isMountedRef.current = true;

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

      // Release the concurrency guard: we've just abandoned the in-flight run
      // (its result is discarded by the aborted-signal check), so the *next*
      // lifecycle must be free to start. Without this, a remount that reuses
      // the same refs — React StrictMode's double-invoke, or a Suspense/router
      // remount on client-side navigation — would hit `if (isExecutingRef
      // .current) return` and never re-run, leaving a `useQuery` stuck on its
      // loading skeleton forever (the original request 200s but is dropped).
      isExecutingRef.current = false;
    };
  }, []);

  // The caller's callbacks and `id`, read through a ref so they never enter
  // `executeAction`'s dependency list. `useQuery` hands `useAction` a freshly
  // allocated inline `onSuccess` on every render; listing it as a dep rebuilt
  // `executeAction` → `runAction` → `run` / `refetch` / `cancel` each time, so
  // every consumer keyed on one of those identities churned, and a consumer
  // effect shaped `useEffect(() => { refetch() }, [refetch])` looped forever.
  //
  // Assigned during render (the same pattern as `useSelector`): the callbacks
  // invoked are always the latest ones the caller passed, never a
  // first-render closure.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const executeAction = useCallback(
    async (
      args: Args,
      { supersede = false }: { supersede?: boolean } = {},
    ): Promise<Result | undefined> => {
      if (isExecutingRef.current && !supersede) {
        // A manual `run()` must not fire twice — this is what stops a
        // double-clicked mutation from being submitted twice.
        return;
      }

      // A dep-change or interval run supersedes: the in-flight request was
      // issued for inputs that are now stale, so its result must never win.
      // (This is why the guard above is skipped rather than short-circuiting —
      // otherwise `useQuery([userId])` whose `userId` changes mid-flight would
      // never refetch, and the old user's data would stay on screen.)
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const runId = ++runIdRef.current;
      const isLatestRun = () => runIdRef.current === runId;

      isExecutingRef.current = true;
      setLoading(true);
      setError(undefined);

      try {
        await alepha.events.emit("react:action:begin", {
          type: "custom",
          id: optionsRef.current.id,
        });
        // Pass abort signal as last argument to handler
        const result = await optionsRef.current.handler(...args, {
          signal: abortController.signal,
        } as any);

        // Only update state if still mounted, not aborted, and not superseded
        if (
          !isMountedRef.current ||
          abortController.signal.aborted ||
          !isLatestRun()
        ) {
          return;
        }

        setResult(result as Result);

        await alepha.events.emit("react:action:success", {
          type: "custom",
          id: optionsRef.current.id,
        });

        // Invalidate before the caller's `onSuccess`, so a handler that
        // navigates or reads the cache sees the post-mutation state.
        // Resolved here rather than injected at the top of the hook: injecting
        // unconditionally would make every `useAction` require the react
        // module to be loaded, breaking containers that use the hook
        // standalone. Only callers that opt into `invalidates` pay for it.
        const invalidates = optionsRef.current.invalidates;
        if (invalidates) {
          const keys =
            typeof invalidates === "function"
              ? invalidates(result as Result)
              : invalidates;
          const queryCache = alepha.inject(QueryCache);
          for (const key of keys) {
            queryCache.invalidate(key);
          }
        }

        if (optionsRef.current.onSuccess) {
          await optionsRef.current.onSuccess(result);
        }

        return result;
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        // Only update state if still mounted and not superseded
        if (!isMountedRef.current || !isLatestRun()) {
          return;
        }

        const error = err as Error;
        setError(error);

        await alepha.events.emit("react:action:error", {
          type: "custom",
          id: optionsRef.current.id,
          error,
        });

        if (optionsRef.current.onError) {
          await optionsRef.current.onError(error);
        }
        // Without a custom `onError`, the error is NOT re-thrown: it is captured
        // in `error` state and emitted as `react:action:error` (a mounted
        // <ActionErrorToaster /> surfaces it as a toast). This keeps
        // fire-and-forget `action.run()` calls from producing unhandled
        // promise rejections.
      } finally {
        // A superseded run must not release the guard or drop `loading` — the
        // run that replaced it is still in flight.
        if (isLatestRun()) {
          isExecutingRef.current = false;
          if (isMountedRef.current) {
            setLoading(false);
          }
        }

        await alepha.events.emit("react:action:end", {
          type: "custom",
          id: optionsRef.current.id,
        });

        // Clean up abort controller
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = undefined;
        }
      }
    },
    [...deps],
  );

  const runAction = useCallback(
    async (
      args: Args,
      options_: { supersede?: boolean } = {},
    ): Promise<Result | undefined> => {
      if (options.debounce) {
        // Settle the superseded call. `cancel()`, unmount, and a newer call
        // all clear the timer — and the promise returned to THAT caller was
        // only ever resolved inside the timeout, so `await action.run(...)`
        // hung forever. Resolving `undefined` matches the declared
        // `Promise<Result | undefined>`.
        pendingDebounce.current?.();
        if (debounceTimerRef.current) {
          dateTimeProvider.clearTimeout(debounceTimerRef.current);
        }

        return new Promise<Result | undefined>((resolve) => {
          pendingDebounce.current = () => {
            pendingDebounce.current = undefined;
            resolve(undefined);
          };
          debounceTimerRef.current = dateTimeProvider.createTimeout(
            async () => {
              pendingDebounce.current = undefined;
              const result = await executeAction(args, options_);
              resolve(result);
            },
            options.debounce ?? 0,
          );
        });
      }

      return executeAction(args, options_);
    },
    [executeAction, options.debounce],
  );

  /**
   * Public `run()` — a user-initiated call. Deduped while one is in flight so a
   * double-clicked mutation submits once.
   */
  const handler = useCallback(
    (...args: Args): Promise<Result | undefined> => runAction(args),
    [runAction],
  );

  /**
   * Public `refetch()` — re-run with the same semantics as a dep change: the
   * in-flight request (if any) is aborted and a fresh one starts. This is
   * what `useQuery.refetch()` uses — `run()`'s double-click dedup would
   * silently drop a refetch issued during a slow fetch or an active poll.
   */
  const refetch = useCallback(
    (...args: Args): Promise<Result | undefined> =>
      runAction(args, { supersede: true }),
    [runAction],
  );

  const cancel = useCallback(() => {
    // clear debounce timer
    pendingDebounce.current?.();
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

  // Run action on mount, and again whenever `deps` change — or when
  // `runOnInit` itself flips to true (the `useQuery` `enabled: !!userId` gate
  // pattern: the fetch must start the moment the gate opens, not stay a
  // skeleton forever). These runs supersede an in-flight request: it was
  // issued for the previous deps, so its result is already stale.
  useEffect(() => {
    if (options.runOnInit) {
      runAction([] as any, { supersede: true });
    }
  }, [...deps, options.runOnInit]);

  // The interval must not depend on `runAction`'s identity: `useQuery` passes
  // a fresh inline `onSuccess` on every render, which rebuilds `runAction`,
  // which used to tear the interval down and start it over. A component
  // re-rendering faster than the polling period then never polled at all.
  const runActionRef = useRef(runAction);
  useEffect(() => {
    runActionRef.current = runAction;
  });

  // Same reason for the period: the documented tuple form (`[5, "seconds"]`)
  // is a fresh array each render, so the effect keys on its value, not its
  // identity.
  const runEveryMs = options.runEvery
    ? dateTimeProvider.duration(options.runEvery).as("milliseconds")
    : undefined;

  // Run action periodically if runEvery is specified
  useEffect(() => {
    if (!runEveryMs) {
      return;
    }

    // Set up interval
    intervalRef.current = dateTimeProvider.createInterval(
      () => runActionRef.current([] as any, { supersede: true }),
      runEveryMs,
      true,
    );

    // cleanup on unmount or when runEvery changes
    return () => {
      if (intervalRef.current) {
        dateTimeProvider.clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
    };
  }, [runEveryMs]);

  return {
    run: handler,
    refetch,
    loading,
    error,
    cancel,
    result,
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
  handler: (...args: [...Args, ActionContext]) => Async<Result>;

  /**
   * Custom error handler. With or without one, errors are never re-thrown by
   * `run` — they are captured in `error` state and emitted as
   * `react:action:error`, so fire-and-forget calls can't produce unhandled
   * promise rejections.
   */
  onError?: (error: Error) => void | Promise<void>;

  /**
   * Custom success handler.
   */
  onSuccess?: (result: Result) => void | Promise<void>;

  /**
   * Query cache keys to invalidate after a successful run.
   *
   * Matching is by prefix, so `[["folios"]]` drops every entry under that
   * prefix regardless of trailing key members. Mounted `useQuery` hooks whose
   * key was dropped refetch automatically — this is the replacement for
   * hand-patching atoms after a write.
   *
   * Pass a function to derive keys from the result, e.g. when the id of the
   * created row is only known afterwards.
   *
   * ```tsx
   * const remove = useAction(
   *   {
   *     handler: async (id: string) => api.delete({ params: { id } }),
   *     invalidates: [["folios", campaignId]],
   *   },
   *   [campaignId],
   * );
   * ```
   */
  invalidates?: unknown[][] | ((result: Result) => unknown[][]);

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
   * Re-execute the action, aborting the in-flight request if any (same
   * supersede semantics as a dependency change). Unlike `run()`, this is
   * never dropped by the double-click dedup guard.
   */
  refetch: (...args: Args) => Promise<Result | undefined>;

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

  /**
   * The result data from the last successful action execution.
   */
  result?: Result;
}
