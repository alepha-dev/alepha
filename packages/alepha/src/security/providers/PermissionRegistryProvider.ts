import { $inject, Alepha } from "alepha";

/**
 * Answers "does the caller hold this permission?" from the set the server sent
 * down with the API registry.
 *
 * The server resolves a user's roles into concrete permission names before
 * sending them (`SecurityProvider.getPermissions`, where a `*` role expands to
 * the full list), so this side never has to resolve a role — it matches names
 * against an already-flat list. A wildcard is therefore only meaningful on the
 * *requirement* (`orders:*` = "anything in this group"), never on a grant.
 *
 * ## Why this reads the store instead of injecting `LinkProvider`
 *
 * `LinkProvider.can()` answers the same question and is the canonical
 * implementation — but it lives in `alepha/server/links`, which already imports
 * types from `alepha/security`. A value import back would close the loop
 * `security -> server/links -> security`, which the build's module analyzer
 * rejects (it counts type-only imports as edges).
 *
 * So this reads the same store key `LinkProvider` reads, and duplicates only
 * the matching rule — six lines, pinned against `LinkProvider` by
 * `server/links/__tests__/permission-matching-parity.spec.ts` so the two cannot
 * drift apart silently.
 *
 * Nothing here enforces anything: the browser is not an enforcement point, and
 * the server re-checks every permission on the real request. This exists so the
 * UI agrees with the answer the server would give.
 */
export class PermissionRegistryProvider {
  protected readonly alepha = $inject(Alepha);

  /**
   * Concrete permission names granted to the current caller. Empty before the
   * registry has arrived (pre-login, pre-`ping`), which denies by default —
   * the safe direction for a UI gate.
   */
  public get granted(): string[] {
    const registry = this.alepha.store.get("alepha.server.request.apiLinks") as
      | { permissions?: string[] }
      | undefined;

    return registry?.permissions ?? [];
  }

  /**
   * Match one requirement against the granted set.
   *
   * A trailing `*` matches any grant sharing the prefix; anything else is an
   * exact match.
   */
  public can(name: string): boolean {
    const granted = this.granted;

    if (name.endsWith("*")) {
      const prefix = name.slice(0, -1);
      return granted.some((it) => it.startsWith(prefix));
    }

    return granted.includes(name);
  }
}
