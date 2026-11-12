/**
 * The framework's one Trusted Types policy, `alepha`.
 *
 * With `contentSecurityPolicy.trustedTypes` on, the server sends
 * `require-trusted-types-for 'script'` and `trusted-types alepha`: a string
 * assigned to a DOM sink that runs code (`innerHTML`, a `<script>`'s text or
 * `src`) is refused unless a policy made it. Every sink the framework and
 * `@alepha/ui` own goes through this one, created once per document on first
 * use.
 *
 * The policy passes its input through: it is used only where the framework
 * builds the value itself (a `$head` script, a deferred value's delivery, a
 * chart's generated CSS, a third-party loader's fixed URL, the server's own
 * QR code SVG). It is not a sanitizer; an app's own sinks need a policy of
 * their own, named in `trustedTypes: ["mine"]`.
 *
 * Where the browser has no `trustedTypes` (the server, an old browser), each
 * method returns its input unchanged and no policy is created.
 */
export class TrustedTypes {
  /**
   * The policy name the server allows in `trusted-types`.
   */
  public static readonly POLICY_NAME = "alepha";

  /**
   * Where the policy is kept: on `globalThis`, so two copies of this module in
   * one page share it. Creating a policy twice under one name is refused by
   * the browser.
   */
  protected static readonly KEY = Symbol.for("alepha.trustedTypes.policy");

  protected static policy(): TrustedTypesPolicyLike | undefined {
    const g = globalThis as {
      trustedTypes?: {
        createPolicy: (
          name: string,
          rules: Record<string, (input: string) => string>,
        ) => TrustedTypesPolicyLike;
      };
      [key: symbol]: unknown;
    };
    if (!g.trustedTypes) {
      return undefined;
    }
    let policy = g[TrustedTypes.KEY] as TrustedTypesPolicyLike | undefined;
    if (!policy) {
      const pass = (input: string) => input;
      policy = g.trustedTypes.createPolicy(TrustedTypes.POLICY_NAME, {
        createHTML: pass,
        createScript: pass,
        createScriptURL: pass,
      });
      g[TrustedTypes.KEY] = policy;
    }
    return policy;
  }

  /**
   * A value for `innerHTML` or React's `dangerouslySetInnerHTML.__html`.
   * Typed as a string, which is what React and the DOM types accept.
   */
  public static html(value: string): string {
    return (TrustedTypes.policy()?.createHTML(value) ?? value) as string;
  }

  /**
   * A value for a `<script>`'s `textContent` or `text`.
   */
  public static script(value: string): string {
    return (TrustedTypes.policy()?.createScript(value) ?? value) as string;
  }

  /**
   * A value for a `<script>`'s `src`.
   */
  public static scriptURL(value: string): string {
    return (TrustedTypes.policy()?.createScriptURL(value) ?? value) as string;
  }
}

/**
 * The shape of a browser `TrustedTypePolicy`, without the DOM lib types.
 */
interface TrustedTypesPolicyLike {
  createHTML(input: string): unknown;
  createScript(input: string): unknown;
  createScriptURL(input: string): unknown;
}
