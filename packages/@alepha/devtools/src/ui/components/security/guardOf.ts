import type { DevActionMetadata } from "../../../schemas/DevActionMetadata.ts";

export interface ActionGuard {
  /**
   * True when the action carries a `$secure` middleware at all. False means
   * anyone reaches it, which is the single most important thing this screen
   * reports.
   */
  guarded: boolean;
  /**
   * Fully-qualified `group:name` permissions the caller must hold. `$secure`
   * requires *all* of them, not any.
   */
  permissions: string[];
  /**
   * Role names the caller must be one of, when the guard names roles directly.
   */
  roles: string[];
  /**
   * A custom `guard()` callback runs after every other check and can deny
   * per-request on data this screen cannot see — so a row that looks reachable
   * may still not be.
   */
  hasCallback: boolean;
}

/**
 * Read an action's `$secure` options out of its middleware metadata.
 *
 * The middleware list is the only place this survives to the browser: the
 * options object is attached at declaration time, so a guard that was written
 * but never wired shows up here as absent rather than as a lie.
 */
export const guardOf = (action: DevActionMetadata): ActionGuard => {
  const secure = action.middlewares?.find((m) => m.name === "$secure");
  const options = (secure?.options ?? {}) as {
    permissions?: Array<string | { name: string; group?: string }>;
    roles?: string[];
    guard?: unknown;
  };

  return {
    guarded: !!secure,
    permissions: (options.permissions ?? []).map((permission) =>
      typeof permission === "string"
        ? permission
        : permission.group
          ? `${permission.group}:${permission.name}`
          : permission.name,
    ),
    roles: options.roles ?? [],
    hasCallback: !!secure && "guard" in options,
  };
};

export const requiredPermissions = (action: DevActionMetadata): string[] =>
  guardOf(action).permissions;
