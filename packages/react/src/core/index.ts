import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export { default as ClientOnly } from "./components/ClientOnly.tsx";
export type * from "./components/ClientOnly.tsx";
export { default as ErrorBoundary } from "./components/ErrorBoundary.tsx";
export type * from "./components/ErrorBoundary.tsx";
export * from "./contexts/AlephaProvider.tsx";
export * from "./contexts/AlephaContext.ts";
export * from "./hooks/useAction.ts";
export * from "./hooks/useAlepha.ts";
export * from "./hooks/useEvents.ts";
export * from "./hooks/useInject.ts";
export * from "./hooks/useClient.ts";
export * from "./hooks/useStore.ts";

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
 * Provides full-stack React development with declarative routing, server-side rendering, and client-side hydration.
 *
 * The React module enables building modern React applications using the `$page` primitive on class properties.
 * It delivers seamless server-side rendering, automatic code splitting, and client-side navigation with full
 * type safety and schema validation for route parameters and data.
 *
 * @see {@link $page}
 * @module alepha.react
 */
export const AlephaReact = $module({
  name: "alepha.react.core",
});
