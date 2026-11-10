import {
  type ConventionFile,
  ConventionRule,
  type ConventionRuleFinding,
} from "./ConventionRule.ts";

/**
 * `no-date-now`: refuses `Date.now()` and `globalThis.Date.now()` in non-spec
 * source.
 *
 * A clock read from `Date` cannot be moved by a test. `DateTimeProvider` can:
 * `travel()` and `pause()` make every expiry, retry and schedule testable
 * without waiting, which is a property the framework sells.
 *
 * Edge decisions:
 *
 * - `new Date()` with no argument is NOT refused. It stays a review matter,
 *   as in the repository's own check.
 * - `const { now } = Date` and `Date["now"]()` are not reported: the rule
 *   reads the plain call, which is the one written by accident.
 * - `globalThis.Date.now()` IS reported: it is the same clock.
 * - Tests are out of scope (`*.spec.*`, `__tests__/`, `test/`, `e2e/`,
 *   `fixtures/`): a test may do what is convenient.
 * - A `*.browser.ts(x)` entry point is NOT skipped. No case of a `Date.now()`
 *   needed before the container exists was found in the framework or in
 *   Lore when the rule was written, and a component has
 *   `useInject(DateTimeProvider)`. One that turns up is exempted on its line
 *   with its reason.
 */
export class NoDateNowRule extends ConventionRule {
  public readonly id = "no-date-now";
  public readonly description = "Date.now() cannot be travelled in a test.";
  public readonly fix =
    "Inject DateTimeProvider and call this.dateTime.nowMillis() (or now()), so a test can travel(). In a component, useInject(DateTimeProvider).";

  public appliesTo(relativePath: string): boolean {
    return !this.isTestPath(relativePath);
  }

  public check(file: ConventionFile, program: any): ConventionRuleFinding[] {
    const findings: ConventionRuleFinding[] = [];
    this.walk(program, (node) => {
      if (
        node.type === "CallExpression" &&
        this.isMember(node.callee, "Date", "now")
      ) {
        findings.push(this.at(file, node));
      }
    });
    return findings;
  }
}
