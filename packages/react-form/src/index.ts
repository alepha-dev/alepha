import { $module } from "@alepha/core";

export * from "./hooks/useForm.ts";

/**
 * React hooks for managing forms in Alepha applications.
 *
 * This module provides a set of hooks to simplify form handling, validation, and submission in React applications built with Alepha.
 *
 * It includes:
 * - `useForm`: A hook for managing form state, validation, and submission.
 *
 * @see {@link useForm}
 * @module alepha.react.form
 */
export const AlephaReactForm = $module({
	name: "alepha.react.form",
});
