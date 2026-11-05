/**
 * Well-known `meta` key: the roles this middleware admits, any one of which
 * lets the visitor through.
 *
 * A comma-separated list (`"admin,editor"`), since `meta` is a flat
 * `Record<string, string>`. `$secure` sets it when it is given `roles`.
 *
 * The OpenAPI generator reads it into an operation's `x-alepha-security`, so a
 * viewer can tell a visitor which routes their role reaches. Like
 * {@link MIDDLEWARE_PROTECTED}, it describes the gate and never decides it.
 */
export const MIDDLEWARE_ROLES = "roles";
