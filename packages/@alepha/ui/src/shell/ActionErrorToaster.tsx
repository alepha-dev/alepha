import * as React from "react";

void React;

import { useEvents } from "alepha/react";

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
 * Mounted by default inside {@link AppShell}; opt out with
 * `actionErrorToaster={false}` or pass an options object to configure it.
 * Requires a `<Toaster />` in the tree (AppShell mounts one).
 */
export const ActionErrorToaster = (props: ActionErrorToasterProps) => {
  const toast = useToast();
  const enabled = props.enabled ?? true;

  useEvents(
    {
      "react:action:error": (event: ActionErrorEvent) => {
        if (!enabled) return;
        if (event.handled) return;
        const error = event.error;
        if (!error) return;
        if (props.filter && !props.filter(error, event)) return;
        const message = props.format
          ? props.format(error, event)
          : error.message;
        toast.error(
          message,
          props.duration ? { duration: props.duration } : undefined,
        );
      },
    },
    [enabled, toast, props.format, props.filter, props.duration],
  );

  return null;
};
