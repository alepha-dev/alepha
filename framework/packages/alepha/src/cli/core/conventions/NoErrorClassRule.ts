import {
  type ConventionFile,
  ConventionRule,
  type ConventionRuleFinding,
} from "./ConventionRule.ts";

/**
 * `no-error-class`: refuses a class whose SUPERCLASS name ends in `Error`:
 * `extends Error`, `extends AlephaError`, `extends HttpError`,
 * `extends errors.NotFoundError`.
 *
 * `$error({ name, schema })` and `.extend({ ... })` build the classes, so a
 * declared error is a constant the registry knows by name: the browser
 * rebuilds it from a response body, and `instanceof` holds on both sides. A
 * hand-written class is invisible to that registry and comes back as a plain
 * error.
 *
 * Edge decisions:
 *
 * - The predicate is the superclass, not the class's own name:
 *   `class Rollback extends HttpError` is reported, `class ParseError extends
 *   Base` is not.
 * - A member superclass is read by its last name (`errors.NotFoundError`).
 * - Tests are out of scope: a spec may throw a local `class Rollback extends
 *   Error` as control flow.
 */
export class NoErrorClassRule extends ConventionRule {
  public readonly id = "no-error-class";
  public readonly description =
    "An error class is invisible to the registry the browser rebuilds errors from.";
  public readonly fix =
    "Declare it with $error({ name, schema }), or derive one with Parent.extend({ name }).";

  public appliesTo(relativePath: string): boolean {
    return !this.isTestPath(relativePath);
  }

  public check(file: ConventionFile, program: any): ConventionRuleFinding[] {
    const findings: ConventionRuleFinding[] = [];
    this.walk(program, (node) => {
      if (
        (node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
        this.nameOf(node.superClass)?.endsWith("Error")
      ) {
        findings.push(this.at(file, node));
      }
    });
    return findings;
  }
}
