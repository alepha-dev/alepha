import * as React from "react";

void React;

import { toast as sonner } from "sonner";

/**
 * Intent buckets for `Toast.show`. Maps internally to icon + colour
 * variants. Keep the vocabulary stable — call sites name *meaning*,
 * not visual style.
 */
export type ToastIntent = "primary" | "success" | "info" | "warning" | "danger";

/**
 * Cross-intent options. Intentionally a small, framework-defined shape
 * (rather than re-exporting sonner's `ExternalToast`) so the underlying
 * library can be swapped without touching consumer code. Add fields
 * here as consumers genuinely need them.
 */
export interface ToastOptions {
  /** Action button shown next to the toast. */
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss delay in ms. */
  duration?: number;
  /** Secondary description line under the main message. */
  description?: string;
}

/**
 * Toast API returned by {@link useToast}. Per-intent shortcuts cover
 * the common case (`toast.success(msg)`); `show` is the generic entry
 * for code that picks the intent dynamically.
 */
export interface Toast {
  show(message: string, intent?: ToastIntent, options?: ToastOptions): void;
  success(message: string, options?: ToastOptions): void;
  error(message: string, options?: ToastOptions): void;
  warning(message: string, options?: ToastOptions): void;
  info(message: string, options?: ToastOptions): void;
}

/**
 * Imperative toast hook. Requires a `<Toaster />` mounted somewhere in
 * the tree (from `@alepha/ui/components/ui/sonner`).
 *
 * The underlying library (currently sonner) is an implementation
 * detail — never exported from this module. Consumers depend on the
 * `Toast` interface, not on sonner's API. This keeps the door open to
 * swapping libraries or adding cross-cutting behavior (dedup,
 * rate-limit, branded icons) without rippling through call sites.
 *
 * @example
 * const toast = useToast();
 * toast.success("Saved");
 * toast.error(err.message, { description: "Please try again" });
 * toast.show(message, intent, { action: { label: "Undo", onClick } });
 */
// Bridge our shape to sonner's. ToastOptions is intentionally a
// strict subset; using sonner's own parameter type derives it without
// importing the name, so this file's type surface stays sonner-free.
type SonnerOptions = Parameters<typeof sonner.success>[1];
const toSonner = (options?: ToastOptions): SonnerOptions =>
  options as SonnerOptions;

// A single module-level instance: the API closes over nothing per-render,
// and consumers put it in useCallback/useEffect dependency arrays — a fresh
// object each render would invalidate those deps every render, turning any
// state-setting effect downstream into an infinite loop.
const toast: Toast = {
  show(message, intent = "primary", options) {
    const opts = toSonner(options);
    if (intent === "success") return sonner.success(message, opts);
    if (intent === "danger") return sonner.error(message, opts);
    if (intent === "warning") return sonner.warning(message, opts);
    if (intent === "info") return sonner.info(message, opts);
    // Neutral "primary" — sonner exposes `.message` for the unflavoured toast.
    sonner.message(message, opts);
  },
  success(message, options) {
    sonner.success(message, toSonner(options));
  },
  error(message, options) {
    sonner.error(message, toSonner(options));
  },
  warning(message, options) {
    sonner.warning(message, toSonner(options));
  },
  info(message, options) {
    sonner.info(message, toSonner(options));
  },
};

export function useToast(): Toast {
  return toast;
}
