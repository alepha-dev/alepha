import { useAlepha, useStore } from "alepha/react";
import { currentUserAtom } from "alepha/security";
import { LinkProvider } from "alepha/server/links";
import { useCallback } from "react";

import type { OpenApiSpec, SwaggerEntry } from "./OpenApiSpec.ts";

/**
 * Whether the viewer may call an operation:
 *
 * - `open`: no gate;
 * - `anonymous`: gated, and nobody is signed in;
 * - `allowed` / `denied`: gated, and the signed-in user's action registry
 *   (`/api/_links`, built per user) does or does not list it;
 * - `unknown`: gated and signed in, with no registry to ask (the app does not
 *   use `alepha/server/links`, or the operation is not an `$action`).
 */
export type SwaggerAccess =
  | "open"
  | "anonymous"
  | "allowed"
  | "denied"
  | "unknown";

/**
 * Answers {@link SwaggerAccess} for each operation, against the current user.
 *
 * Read from what the page already has, never a request per operation: the
 * signed-in user is `currentUserAtom`, and what they may call is the action
 * registry `LinkProvider` holds, the one `useAuth().has()` reads. The
 * registry lists only the actions the user's permissions reach, so an action
 * present in it is one they may call. A UI affordance, not a decision: the
 * server's `$secure` still answers every request.
 */
export const useSwaggerAccess = (
  spec: OpenApiSpec | undefined,
): ((entry: SwaggerEntry) => SwaggerAccess) => {
  const alepha = useAlepha();
  const [user] = useStore(currentUserAtom);

  return useCallback(
    (entry: SwaggerEntry): SwaggerAccess => {
      if (!spec || !spec.isSecured(entry.operation)) {
        return "open";
      }
      if (!user) {
        return "anonymous";
      }
      const name = spec.metadata(entry.operation).action?.name;
      // Injecting LinkProvider in an app without its module would register
      // that module after start, which the container refuses.
      if (!name || !alepha.has(LinkProvider)) {
        return "unknown";
      }
      return alepha.inject(LinkProvider).can(name) ? "allowed" : "denied";
    },
    [alepha, spec, user],
  );
};
