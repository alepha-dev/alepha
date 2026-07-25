import { $module } from "alepha";
import { queryCacheAtom } from "./atoms/queryCacheAtom.ts";
import { QueryCache } from "./services/QueryCache.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/queryCacheAtom.ts";
export type * from "./components/ClientOnly.tsx";
export { default as ClientOnly } from "./components/ClientOnly.tsx";
export type * from "./components/ErrorBoundary.tsx";
export { default as ErrorBoundary } from "./components/ErrorBoundary.tsx";
export * from "./contexts/AlephaContext.ts";
export * from "./contexts/AlephaProvider.tsx";
export * from "./hooks/useAction.ts";
export * from "./hooks/useAlepha.ts";
export * from "./hooks/useClient.ts";
export * from "./hooks/useComputed.ts";
export * from "./hooks/useEvents.ts";
export * from "./hooks/useInject.ts";
export * from "./hooks/useQuery.ts";
export * from "./hooks/useQueryClient.ts";
export * from "./hooks/useSelector.ts";
export * from "./hooks/useStore.ts";
export * from "./services/QueryCache.ts";
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
 * Full-stack React framework with server-side rendering.
 *
 * **Features:**
 * - React page routes with type-safe params
 * - Async action handler with loading/error/cancel states
 * - Type-safe HTTP client access
 * - Dependency injection in components
 * - Global state management
 * - Router navigation methods
 * - Current route state access
 * - Check if path is active
 * - URL query parameters
 * - Access route schema
 * - Subscribe to Alepha events
 * - Type-safe form handling with validation
 * - Error handling wrapper component
 * - Client-side only rendering component
 * - Server-side rendering with hydration
 * - Automatic code splitting
 * - Event system for action tracking
 *
 * @module alepha.react
 */
export const AlephaReact = $module({
  name: "alepha.react.core",
  // Registered up front rather than lazily on first write, so a page that
  // server-renders a query has the atom present when `exportAtoms` builds the
  // hydration payload.
  atoms: [queryCacheAtom],
  services: [QueryCache],
});
