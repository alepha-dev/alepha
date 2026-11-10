import {
  type ConventionFile,
  ConventionRule,
  type ConventionRuleFinding,
} from "./ConventionRule.ts";

/**
 * `describe-it`: refuses a `test()` or `it()` case (modifiers included:
 * `it.skip`, `test.each([...])(...)`) that is not inside a `describe()`.
 *
 * A case at the top level of a spec has no subject in the reporter and no
 * handle for `vitest run -t`.
 *
 * Edge decisions:
 *
 * - A case inside a function that is not a `describe` callback is not
 *   reported: a helper defining shared cases is called from inside a
 *   `describe`, and the parser cannot tell where it is called from.
 * - A case inside a top-level loop or `if` IS reported: it is still at the
 *   top level of the file.
 * - Playwright files are exempt, by path (`e2e/`, `*.e2e.ts(x)`) and by
 *   import (any file importing `@playwright/test`): Playwright's API is
 *   `test`, with no `it` to move to.
 *
 * Reads spec files only (`*.spec.*`, `*.test.*`).
 */
export class DescribeItRule extends ConventionRule {
  public readonly id = "describe-it";
  public readonly description = "A test case outside any describe().";
  public readonly fix =
    'Wrap the cases in describe("<unit>", () => { ... }) and write each one as it().';

  public appliesTo(relativePath: string): boolean {
    return (
      this.isSpecFile(relativePath) &&
      !/(^|\/)e2e\//.test(relativePath) &&
      !/\.e2e\.tsx?$/.test(relativePath)
    );
  }

  public check(file: ConventionFile, program: any): ConventionRuleFinding[] {
    if (this.importsPlaywright(program)) {
      return [];
    }

    const findings: ConventionRuleFinding[] = [];
    this.walk(program, (node, parents) => {
      if (node.type !== "CallExpression") {
        return;
      }
      const name = this.rootName(node.callee);
      if (name !== "test" && name !== "it") {
        return;
      }
      // `test.each(rows)` is itself a call whose root is `test`: report the
      // outer call only.
      const parent = parents.at(-1);
      if (parent?.type === "CallExpression" && parent.callee === node) {
        return;
      }
      if (!this.isEnclosed(parents)) {
        findings.push(this.at(file, node));
      }
    });
    return findings;
  }

  /**
   * Whether a case sits inside a `describe` callback, or inside any other
   * function (see the class's edge decisions).
   */
  protected isEnclosed(parents: any[]): boolean {
    return parents.some(
      (node) =>
        node.type === "ArrowFunctionExpression" ||
        node.type === "FunctionExpression" ||
        node.type === "FunctionDeclaration",
    );
  }

  /**
   * The identifier a callee chain starts from: `it`, `it.skip`,
   * `test.each([...])` and `describe.only` all give their first name.
   */
  protected rootName(node: any): string | undefined {
    let current = node;
    while (current) {
      if (current.type === "Identifier") {
        return current.name;
      }
      if (current.type === "MemberExpression") {
        current = current.object;
      } else if (current.type === "CallExpression") {
        current = current.callee;
      } else if (current.type === "TaggedTemplateExpression") {
        current = current.tag;
      } else {
        return undefined;
      }
    }
    return undefined;
  }

  protected importsPlaywright(program: any): boolean {
    return (program?.body ?? []).some(
      (node: any) =>
        node.type === "ImportDeclaration" &&
        node.source?.value === "@playwright/test",
    );
  }
}
