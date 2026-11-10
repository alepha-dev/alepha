import {
  type ConventionFile,
  ConventionRule,
  type ConventionRuleFinding,
} from "./ConventionRule.ts";

/**
 * `no-module-code`: refuses a module-level `const`, `let`, `var` or function
 * declaration, exported or not, in a service-shaped file.
 *
 * A helper beside a class cannot be substituted through the container, so a
 * test cannot replace it and a subclass cannot override it. On the class, as
 * a `protected` member, it can.
 *
 * Service-shaped means under a directory named in {@link directories}:
 * `services`, `providers`, `controllers` and `jobs` by default, all of them
 * DI classes whose members a test substitutes. `schemas/`, `entities/`,
 * `atoms/` and `errors/` are module-level constants by definition (an
 * `$error` or an `$atom` is declared once at module level) and are never
 * read. A project that keeps services in other directories registers a
 * subclass that extends the list.
 *
 * Edge decisions:
 *
 * - The predicate is a declaration at the top level of the module. A second
 *   class, an `enum`, a `type` or an `interface` is not reported, and neither
 *   is `declare const` (it emits nothing).
 * - Code inside a string (a template literal holding generated source) is not
 *   code in the parsed tree, so it is never a finding.
 * - Tests are out of scope.
 */
export class NoModuleCodeRule extends ConventionRule {
  public readonly id = "no-module-code";
  public readonly description =
    "Code outside the class cannot be substituted through the container.";
  public readonly fix =
    "Move it onto the class as a protected member, so a test or a subclass can replace it.";

  /**
   * The directory names whose files hold services. Extend it in a subclass.
   */
  protected readonly directories: string[] = [
    "services",
    "providers",
    "controllers",
    "jobs",
  ];

  public appliesTo(relativePath: string): boolean {
    if (this.isTestPath(relativePath)) {
      return false;
    }
    const segments = relativePath.split("/").slice(0, -1);
    return segments.some((segment) => this.directories.includes(segment));
  }

  public check(file: ConventionFile, program: any): ConventionRuleFinding[] {
    const findings: ConventionRuleFinding[] = [];
    for (const statement of program?.body ?? []) {
      const declaration =
        statement.type === "ExportNamedDeclaration"
          ? statement.declaration
          : statement;
      if (!declaration || declaration.declare) {
        continue;
      }
      if (declaration.type === "VariableDeclaration") {
        const names = declaration.declarations
          .map((it: any) => it.id?.name)
          .filter(Boolean)
          .join(", ");
        findings.push(
          this.at(
            file,
            statement,
            `Module-level ${declaration.kind}${names ? ` ${names}` : ""} beside the class: it cannot be substituted through the container.`,
          ),
        );
      } else if (declaration.type === "FunctionDeclaration") {
        findings.push(
          this.at(
            file,
            statement,
            `Module-level function${declaration.id?.name ? ` ${declaration.id.name}` : ""} beside the class: it cannot be substituted through the container.`,
          ),
        );
      }
    }
    return findings;
  }
}
