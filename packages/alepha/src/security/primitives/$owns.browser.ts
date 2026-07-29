import { createMiddleware, type Middleware } from "alepha";
// Type-only on purpose — the server implementation imports `alepha/orm` and
// `alepha/server`, neither of which belongs in a browser bundle. Erased at
// compile time.
import type { OwnsOptions } from "./$owns.ts";

export type { OwnsOptions };

/**
 * Browser-side stand-in for the resource-scoped authorization gate.
 *
 * Ownership lives in database rows, and the browser cannot load them — so
 * this variant always short-circuits by returning `undefined` without calling
 * the handler, exactly like a `$secure` guard that reads request data. That
 * is the safe direction: the UI hides the action, and the server-side `$owns`
 * is what actually enforces ownership when the real request arrives.
 *
 * Exists so isomorphic code using `$owns` in `use: [...]` type-checks and
 * runs in a browser bundle instead of crashing on a missing export.
 */
export function $owns(options: OwnsOptions): Middleware {
  return createMiddleware({
    name: "$owns",
    options: options as unknown as Record<string, unknown>,
    handler: () => {
      return async () => undefined;
    },
  });
}
