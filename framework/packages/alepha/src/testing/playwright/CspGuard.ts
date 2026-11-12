import { AlephaError } from "alepha";

/**
 * One Content-Security-Policy violation, as the page reported it.
 */
export interface CspViolation {
  /**
   * The directive that blocked it (`script-src-elem`, `img-src`...).
   */
  directive: string;
  /**
   * What was blocked: a URL, or `inline` / `eval` for code.
   */
  blockedURI: string;
  /**
   * The first characters of the blocked inline code, when the policy
   * reports a sample.
   */
  sample?: string;
  /**
   * The page the violation happened on.
   */
  url: string;
}

/**
 * The part of a Playwright `Page` the guard uses, so this module needs no
 * runtime dependency on `@playwright/test`.
 */
interface GuardedPage {
  url(): string;
  addInitScript(script: (mark: string) => void, arg: string): Promise<void>;
  on(
    event: "console",
    listener: (message: { type(): string; text(): string }) => void,
  ): unknown;
}

/**
 * Fails a Playwright test on the first Content-Security-Policy violation of
 * its page, naming the directive and what was blocked.
 *
 * Two sources, because neither sees everything: a `securitypolicyviolation`
 * listener installed before any page script (it carries the directive, the
 * blocked URI and a sample), and the browser's own console report ("...
 * violates the following Content Security Policy directive ..."), which also
 * covers a violation raised before the listener could see it.
 *
 * @example
 * ```ts
 * // e2e/fixtures.ts
 * import { test as base } from "@playwright/test";
 * import { CspGuard } from "alepha/testing/playwright";
 *
 * export * from "@playwright/test";
 * export const test = CspGuard.extend(base);
 * ```
 *
 * Every spec then imports `test` from `./fixtures.ts`, and a new inline
 * script anywhere in the app fails the suite that reaches it.
 */
export class CspGuard {
  /**
   * The console prefix the in-page listener writes its reports under.
   */
  public static readonly MARK = "[alepha:csp-violation]";

  /**
   * Wrap a Playwright `test` so its `page` fixture is guarded.
   */
  public static extend<T extends { extend: (fixtures: any) => any }>(
    test: T,
  ): T {
    return test.extend({
      page: async (
        { page }: { page: GuardedPage },
        // Playwright's fixture callback, usually named `use`: renamed so the
        // React hooks lint does not read it as React's `use`.
        provide: (page: GuardedPage) => Promise<void>,
      ) => {
        const guard = new CspGuard();
        await guard.install(page);
        await provide(page);
        guard.assertClean();
      },
    }) as T;
  }

  /**
   * Every violation seen, in order.
   */
  public readonly violations: CspViolation[] = [];

  /**
   * Start listening on `page`. Call before its first navigation.
   */
  public async install(page: GuardedPage): Promise<void> {
    await page.addInitScript((mark: string) => {
      document.addEventListener(
        "securitypolicyviolation",
        (event) => {
          console.error(
            mark +
              JSON.stringify({
                directive: event.effectiveDirective || event.violatedDirective,
                blockedURI: event.blockedURI || "inline",
                sample: event.sample || undefined,
              }),
          );
        },
        true,
      );
    }, CspGuard.MARK);

    page.on("console", (message) => {
      const text = message.text();
      if (text.startsWith(CspGuard.MARK)) {
        const report = JSON.parse(text.slice(CspGuard.MARK.length));
        this.violations.push({ ...report, url: page.url() });
        return;
      }
      if (
        /violates the following Content Security Policy directive/.test(text)
      ) {
        // The browser's own report. It repeats one the listener already
        // made, so it only counts when the listener saw nothing.
        const directive =
          text.match(/directive:? ["']([a-z-]+)/i)?.[1] ?? "unknown";
        const blockedURI =
          text.match(
            /(?:Loading|Framing|Connecting to) (?:the \w+ )?'([^']+)'/,
          )?.[1] ?? (/inline|eval/i.test(text) ? "inline" : "unknown");
        this.pending.push({
          directive,
          blockedURI,
          url: page.url(),
          sample: text.slice(0, 200),
        });
      }
    });
  }

  /**
   * Browser console reports not (yet) matched by a listener report.
   */
  protected readonly pending: CspViolation[] = [];

  /**
   * Throw on the first violation, naming its directive and blocked URI.
   */
  public assertClean(): void {
    const first = this.violations[0] ?? this.pending[0];
    if (!first) {
      return;
    }
    const total = Math.max(this.violations.length, this.pending.length);
    throw new AlephaError(
      `Content Security Policy violation on ${first.url}: ${first.directive} blocked ${first.blockedURI}` +
        (first.sample ? ` (${first.sample})` : "") +
        (total > 1 ? `, and ${total - 1} more` : ""),
    );
  }
}
