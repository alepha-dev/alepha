import * as React from "react";

void React;

import { useEvents } from "alepha/react";
import { useState } from "react";

import { useToast } from "../core/useToast.tsx";

export interface ActionErrorToasterProps {
  /**
   * Disable the toaster without unmounting it. Default: enabled.
   */
  enabled?: boolean;
  /**
   * Map an action error to the toast message. Defaults to `error.message`.
   */
  format?: (error: Error, event: ActionErrorEvent) => string;
  /**
   * Return `false` to skip toasting a given error (e.g. a validation error
   * already shown inline). Defaults to toasting every error.
   */
  filter?: (error: Error, event: ActionErrorEvent) => boolean;
  /**
   * Auto-dismiss delay in ms, forwarded to the toast.
   */
  duration?: number;
}

interface ActionErrorEvent {
  id?: string;
  error?: Error;
  handled?: boolean;
}

/**
 * Behaviour-only component (renders nothing): subscribes to the
 * `react:action:error` event that every `useAction` / `useQuery` emits on
 * failure and surfaces it as a single toast.
 *
 * This is the "one toast for all" centraliser — with it mounted, call sites no
 * longer need their own `try/catch + toast.error` around every mutation; an
 * unhandled action error becomes a toast automatically.
 *
 * A handled error is skipped, before `filter` runs: one whose action, query or
 * form was given an `onError`, or a form's field error already shown under its
 * field. That is how a call site stays quiet on purpose, or shows its own
 * message without a second toast beside it.
 *
 * The same error arriving twice toasts once. Components reading one keyed
 * `useQuery` share a single request, so its rejection reaches every one of
 * them, and each emits the event: without this, every panel reading one
 * failed read stacked its own copy of the same toast.
 *
 * Mounted by default inside {@link AppShell}; opt out with
 * `actionErrorToaster={false}` or pass an options object to configure it.
 * Requires a `<Toaster />` in the tree (AppShell mounts one).
 */
export const ActionErrorToaster = (props: ActionErrorToasterProps) => {
  const toast = useToast();
  const enabled = props.enabled ?? true;
  /**
   * Errors already toasted, by identity. Weak, so an error nothing else holds
   * is still collected.
   */
  const [toasted] = useState(() => new WeakSet<Error>());

  useEvents(
    {
      "react:action:error": (event: ActionErrorEvent) => {
        if (!enabled) return;
        if (event.handled) return;
        const error = event.error;
        if (!error) return;
        if (toasted.has(error)) return;
        if (props.filter && !props.filter(error, event)) return;
        toasted.add(error);
        const message = props.format
          ? props.format(error, event)
          : error.message;
        toast.error(
          message,
          props.duration ? { duration: props.duration } : undefined,
        );
      },
    },
    [enabled, toast, toasted, props.format, props.filter, props.duration],
  );

  return null;
};
