import {
  type ConventionFile,
  ConventionRule,
  type ConventionRuleFinding,
} from "./ConventionRule.ts";

/**
 * `no-zod-import`: refuses importing `"zod"` or `"zod/*"` (an `import`, a
 * re-export, a dynamic `import()` or a `require`).
 *
 * The framework's `z` carries its own defaults and extensions (`z.text()`,
 * `z.integer()`), and a second copy of zod produces schemas that are not
 * type-compatible with it: an `$action` typed with one refuses the other.
 *
 * Tests are out of scope (`*.spec.*`, `__tests__/`, `test/`, `e2e/`,
 * `fixtures/`), as for the other core rules.
 */
export class NoZodImportRule extends ConventionRule {
  public readonly id = "no-zod-import";
  public readonly description =
    "A second copy of zod is not type-compatible with the framework's z.";
  public readonly fix =
    'Import z from "alepha": it carries the framework\'s defaults and extensions.';

  public appliesTo(relativePath: string): boolean {
    return !this.isTestPath(relativePath);
  }

  public check(file: ConventionFile, program: any): ConventionRuleFinding[] {
    const findings: ConventionRuleFinding[] = [];
    this.walk(program, (node) => {
      if (
        (node.type === "ImportDeclaration" ||
          node.type === "ExportNamedDeclaration" ||
          node.type === "ExportAllDeclaration" ||
          node.type === "ImportExpression") &&
        this.isZod(node.source)
      ) {
        findings.push(this.at(file, node));
      }
      if (
        node.type === "CallExpression" &&
        node.callee?.type === "Identifier" &&
        node.callee.name === "require" &&
        this.isZod(node.arguments?.[0])
      ) {
        findings.push(this.at(file, node));
      }
    });
    return findings;
  }

  /**
   * A string literal naming `zod` or a subpath of it.
   */
  protected isZod(node: any): boolean {
    const value = node?.type === "Literal" ? node.value : undefined;
    return (
      typeof value === "string" && (value === "zod" || value.startsWith("zod/"))
    );
  }
}
