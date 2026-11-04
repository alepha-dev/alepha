/**
 * Well-known `meta` key: the permissions this middleware requires, all of
 * which the visitor must hold.
 *
 * A comma-separated list of permission names (`"orders:read,orders:delete"`),
 * since `meta` is a flat `Record<string, string>`. `$secure` sets it when it
 * is given `permissions`.
 *
 * The OpenAPI generator reads it into an operation's `x-alepha-security`, so a
 * viewer can tell a visitor which routes they may call. Like
 * {@link MIDDLEWARE_PROTECTED}, it describes the gate and never decides it.
 */
export const MIDDLEWARE_PERMISSIONS = "permissions";
