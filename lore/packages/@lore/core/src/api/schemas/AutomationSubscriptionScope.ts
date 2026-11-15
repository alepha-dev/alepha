import { AlephaError } from "alepha";

/**
 * The scope of a subscription (#Q3635): the setup values its bell binds,
 * such as `{ monitor: "<id>" }` for one monitor's bell, written as one
 * canonical string stored on each rule the bell made.
 *
 * The bell of monitor A and the bell of monitor B differ by scope, so they
 * are independent subscriptions; a list's bell binds nothing, so its scope is
 * `""` and it shares no state with either.
 *
 * Canonical means sorted by key and each value URI-encoded:
 * `{ monitor: "12", env: "prod" }` is `env=prod&monitor=12`, whichever order
 * the caller wrote it in.
 */
export class AutomationSubscriptionScope {
  public static readonly MAX = 255;

  public static encode(scope: Record<string, string> = {}): string {
    const encoded = Object.keys(scope)
      .sort()
      .map((key) => `${key}=${encodeURIComponent(scope[key])}`)
      .join("&");
    if (encoded.length > AutomationSubscriptionScope.MAX)
      throw new AlephaError("A subscription scope is at most 255 characters");
    return encoded;
  }

  public static decode(encoded: string): Record<string, string> {
    const scope: Record<string, string> = {};
    if (!encoded) return scope;
    for (const pair of encoded.split("&")) {
      const at = pair.indexOf("=");
      if (at <= 0) throw new AlephaError("Malformed subscription scope");
      scope[pair.slice(0, at)] = decodeURIComponent(pair.slice(at + 1));
    }
    return scope;
  }
}
