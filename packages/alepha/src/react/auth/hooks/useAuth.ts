import { useAlepha, useStore } from "alepha/react";
import { currentUserAtom } from "alepha/security";
import { LinkProvider } from "alepha/server/links";
import { ReactAuth } from "../services/ReactAuth.ts";

/**
 * Reads the current user and exposes `login()` / `logout()`.
 *
 * `user` comes from the shared `currentUserAtom`, so every component using
 * this hook re-renders together on sign-in and sign-out. The type parameter
 * names your realm's auth providers, making `login("google")` type-safe.
 *
 * @example
 * ```typescript
 * const { user, login, logout } = useAuth();
 * if (!user) {
 *   await login("credentials", { username, password });
 * }
 * ```
 */
export const useAuth = <T extends object = any>() => {
  const alepha = useAlepha();
  const [user] = useStore(currentUserAtom);

  return {
    user,
    logout: () => {
      alepha.inject(ReactAuth).logout();
    },
    login: async (
      provider: keyof T,
      options: {
        username?: string;
        password?: string;
        redirect?: string;
        realm?: string;
        [extra: string]: any;
      } = {},
    ) => {
      await alepha.inject(ReactAuth).login(provider as string, options);
    },
    /**
     * UI permission check — does the current user hold this permission?
     * Supports exact and wildcard names (e.g. `"admin:*"`, `"admin:user:read"`).
     *
     * UI affordance only (show/hide/disable). Real access control is enforced
     * server-side via `$secure` on the route/action.
     */
    has: (permission: string): boolean => {
      return alepha.inject(LinkProvider).can(permission);
    },
  };
};
