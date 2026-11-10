import {
  type ConventionFile,
  ConventionRule,
  type ConventionRuleFinding,
} from "./ConventionRule.ts";

/**
 * `no-bare-error`: refuses throwing the built-in `Error` in non-spec source:
 * `throw new Error(...)`, `throw Error(...)` and
 * `Promise.reject(new Error(...))`.
 *
 * A bare `Error` has no name a caller can catch by type, and the browser
 * cannot rebuild it from a response body. `AlephaError` is the plain
 * failure; an `$error` constant is the one a caller can act on.
 *
 * Edge decisions:
 *
 * - Only `Error` itself. `TypeError`, `RangeError` and the other built-ins
 *   are not reported, as in the repository's own check.
 * - Code emitted as a string (a template literal holding generated source)
 *   is not code in the parsed tree, so it is never a finding.
 * - Tests are out of scope (`*.spec.*`, `__tests__/`, `test/`, `e2e/`,
 *   `fixtures/`).
 */
export class NoBareErrorRule extends ConventionRule {
  public readonly id = "no-bare-error";
  public readonly description =
    "A bare Error has no name a caller can catch by type.";
  public readonly fix =
    'Throw AlephaError from "alepha", or declare an $error when a caller can act on it.';

  public appliesTo(relativePath: string): boolean {
    return !this.isTestPath(relativePath);
  }

  public check(file: ConventionFile, program: any): ConventionRuleFinding[] {
    const findings: ConventionRuleFinding[] = [];
    this.walk(program, (node) => {
      if (node.type === "ThrowStatement" && this.isBareError(node.argument)) {
        findings.push(this.at(file, node));
      }
      if (
        node.type === "CallExpression" &&
        this.isMember(node.callee, "Promise", "reject") &&
        this.isBareError(node.arguments?.[0])
      ) {
        findings.push(this.at(file, node));
      }
    });
    return findings;
  }

  /**
   * `new Error(...)` or `Error(...)`.
   */
  protected isBareError(node: any): boolean {
    return (
      (node?.type === "NewExpression" || node?.type === "CallExpression") &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "Error"
    );
  }
}
