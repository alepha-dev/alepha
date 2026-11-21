import { $module } from "alepha";

import { personalRenderedAtom } from "./atoms/personalRenderedAtom.ts";
import { queryCacheAtom } from "./atoms/queryCacheAtom.ts";
import { QueryCache } from "./services/QueryCache.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/personalRenderedAtom.ts";
export * from "./atoms/queryCacheAtom.ts";
export * from "./atoms/queryOptionsAtom.ts";
export type * from "./components/ClientOnly.tsx";
export { default as ClientOnly } from "./components/ClientOnly.tsx";
export type * from "./components/ErrorBoundary.tsx";
export { default as ErrorBoundary } from "./components/ErrorBoundary.tsx";
export type * from "./components/Personal.tsx";
export { default as Personal } from "./components/Personal.tsx";
export * from "./contexts/AlephaContext.ts";
export * from "./contexts/AlephaProvider.tsx";
export * from "./hooks/useAction.ts";
export * from "./hooks/useAlepha.ts";
export * from "./hooks/useClient.ts";
export * from "./hooks/useComputed.ts";
export * from "./hooks/useEvents.ts";
export * from "./hooks/useInfiniteQuery.ts";
export * from "./hooks/useInject.ts";
export * from "./hooks/useQuery.ts";
export * from "./hooks/useQueryClient.ts";
export * from "./hooks/useSelector.ts";
export * from "./hooks/useStore.ts";
export * from "./services/ActionErrorPolicy.ts";
export * from "./services/QueryCache.ts";
export * from "./services/QueryWakeEvents.ts";
export * from "./services/TrustedTypes.ts";
export * from "./utils/isNetworkError.ts";
export * from "./utils/queryRetry.ts";
export * from "./utils/shallowEqual.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * Fires when a user action is starting.
     * Action can be a form submission, a route transition, or a custom action.
     */
    "react:action:begin": {
      type: string;
      id?: string;
    };
    /**
     * Fires when a user action has succeeded.
     * Action can be a form submission, a route transition, or a custom action.
     */
    "react:action:success": {
      type: string;
      id?: string;
    };
    /**
     * Fires when a user action has failed.
     * Action can be a form submission, a route transition, or a custom action.
     */
    "react:action:error": {
      type: string;
      id?: string;
      error: Error;
      /**
       * The caller already dealt with this error, so it must not be shown
       * again.
       *
       * Set when the action, query or form was given an `onError`, and when a
       * form's `FormValidationError` names a field, which `useFormState` shows
       * under that field. `ActionErrorToaster` skips a handled error. The
       * event still fires for it, because a quiet failure is still a failure:
       * error reporting (the browser sigil) reads it whatever this says.
       */
      handled?: boolean;
    };
    /**
     * Fires when a user action has completed, regardless of success or failure.
     * Action can be a form submission, a route transition, or a custom action.
     */
    "react:action:end": {
      type: string;
      id?: string;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The React bindings of an Alepha container: hooks and components that work
 * with or without the router.
 *
 * **Features:**
 * - Async action handler with loading/error/cancel states
 * - Declarative reads with a keyed cache, invalidation and retries
 * - Type-safe HTTP client access
 * - Dependency injection in components
 * - Global state management
 * - Subscribe to Alepha events
 * - Error handling wrapper component
 * - Client-side only rendering component
 * - Event system for action tracking
 *
 * Page routes, navigation and server-side rendering are `alepha/react/router`;
 * forms are `alepha/react/form`.
 *
 * @module alepha.react
 */
export const AlephaReact = $module({
  name: "alepha.react.core",
  // Registered up front rather than lazily on first write, so a page that
  // server-renders a query has the atom present when `exportAtoms` builds the
  // hydration payload.
  atoms: [personalRenderedAtom, queryCacheAtom],
  services: [QueryCache],
});
