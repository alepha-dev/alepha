import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";

import {
  type ConventionFile,
  ConventionRule,
  type ConventionRuleFinding,
} from "./ConventionRule.ts";

/**
 * `no-window-dialog`: refuses `window.confirm()`, `window.alert()`,
 * `window.prompt()`, and the bare `confirm()`, `alert()` and `prompt()`.
 *
 * The browser's dialogs block the page, cannot be styled, and are what an
 * automated browser dismisses without a trace. `@alepha/ui`'s `useDialog`
 * renders the same three as components, awaitable like the originals.
 *
 * Edge decisions:
 *
 * - `window` means the global identifier: `this.window.alert(...)` is a
 *   member of a class and is not reported.
 * - A bare call is reported only when the file never binds that name. The
 *   test is file-wide, not a scope analysis: an import, a declaration, a
 *   parameter or a destructured prop called `confirm` anywhere in the file
 *   silences every bare `confirm()` in it. It errs toward silence on purpose:
 *   a false report on a local function is worse than a missed global.
 * - Only where `@alepha/ui` is installed: the nearest `package.json` above the
 *   file lists it in `dependencies` or `devDependencies`. Without the kit
 *   there is no `useDialog` to point at, so the rule does not apply.
 * - Tests are out of scope.
 */
export class NoWindowDialogRule extends ConventionRule {
  public readonly id = "no-window-dialog";
  public readonly description =
    "A browser dialog blocks the page and cannot be styled or tested.";
  public readonly fix =
    "const dialog = useDialog() from @alepha/ui, then await dialog.confirm({ title }) (or dialog.alert, dialog.prompt).";

  protected readonly fs = $inject(FileSystemProvider);

  /**
   * The dialog functions refused.
   */
  protected readonly dialogs = new Set(["confirm", "alert", "prompt"]);

  /**
   * Whether the nearest `package.json` above a directory lists `@alepha/ui`,
   * by directory, for the life of the rule.
   */
  protected readonly uiInstalled = new Map<string, Promise<boolean>>();

  public appliesTo(relativePath: string): boolean {
    return !this.isTestPath(relativePath);
  }

  public async check(
    file: ConventionFile,
    program: any,
  ): Promise<ConventionRuleFinding[]> {
    const calls: Array<{ node: any; name: string; bare: boolean }> = [];
    this.walk(program, (node) => {
      if (node.type !== "CallExpression") {
        return;
      }
      const callee = node.callee;
      if (
        callee?.type === "MemberExpression" &&
        !callee.computed &&
        callee.object?.type === "Identifier" &&
        callee.object.name === "window" &&
        this.dialogs.has(callee.property?.name)
      ) {
        calls.push({ node, name: callee.property.name, bare: false });
      } else if (
        callee?.type === "Identifier" &&
        this.dialogs.has(callee.name)
      ) {
        calls.push({ node, name: callee.name, bare: true });
      }
    });

    if (!calls.length || !(await this.hasUi(file.path))) {
      return [];
    }

    const bound = this.boundNames(program);
    return calls
      .filter((call) => !call.bare || !bound.has(call.name))
      .map((call) =>
        this.at(
          file,
          call.node,
          `${call.bare ? "" : "window."}${call.name}() blocks the page and cannot be styled or tested.`,
        ),
      );
  }

  /**
   * Every name the file binds anywhere: imports, declarations, parameters,
   * destructured patterns, classes and catch parameters.
   */
  protected boundNames(program: any): Set<string> {
    const names = new Set<string>();
    const addPattern = (pattern: any): void => {
      if (!pattern) {
        return;
      }
      switch (pattern.type) {
        case "Identifier":
          names.add(pattern.name);
          break;
        case "ObjectPattern":
          for (const property of pattern.properties ?? []) {
            addPattern(
              property.type === "RestElement"
                ? property.argument
                : property.value,
            );
          }
          break;
        case "ArrayPattern":
          for (const element of pattern.elements ?? []) {
            addPattern(element);
          }
          break;
        case "AssignmentPattern":
          addPattern(pattern.left);
          break;
        case "RestElement":
          addPattern(pattern.argument);
          break;
        case "TSParameterProperty":
          addPattern(pattern.parameter);
          break;
      }
    };

    this.walk(program, (node) => {
      switch (node.type) {
        case "ImportSpecifier":
        case "ImportDefaultSpecifier":
        case "ImportNamespaceSpecifier":
          addPattern(node.local);
          break;
        case "VariableDeclarator":
          addPattern(node.id);
          break;
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression":
          addPattern(node.id);
          for (const param of node.params ?? []) {
            addPattern(param);
          }
          break;
        case "ClassDeclaration":
          addPattern(node.id);
          break;
        case "CatchClause":
          addPattern(node.param);
          break;
      }
    });
    return names;
  }

  /**
   * Whether the nearest `package.json` above the file lists `@alepha/ui`.
   */
  protected hasUi(path: string): Promise<boolean> {
    const directory = path.slice(0, path.lastIndexOf("/")) || "/";
    let cached = this.uiInstalled.get(directory);
    if (!cached) {
      cached = this.readUi(directory);
      this.uiInstalled.set(directory, cached);
    }
    return cached;
  }

  protected async readUi(directory: string): Promise<boolean> {
    const manifest = this.fs.join(directory, "package.json");
    if (await this.fs.exists(manifest)) {
      try {
        const json = await this.fs.readJsonFile<{
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        }>(manifest);
        return Boolean(
          json.dependencies?.["@alepha/ui"] ??
          json.devDependencies?.["@alepha/ui"],
        );
      } catch {
        return false;
      }
    }
    if (directory === "/" || !directory.includes("/")) {
      return false;
    }
    return this.hasUi(directory);
  }
}
