import { resolve } from "node:path";

import { AlephaError } from "alepha";
import * as ts from "typescript/unstable/ast";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { API } from "typescript/unstable/sync";

/**
 * Adds a literal Cloudflare declaration without evaluating application code.
 * Unsupported ownership or dynamic configuration is left for a manual edit.
 */
export class InfraConfigEditor {
  protected readonly manualConfig = `import { defineConfig } from "alepha/cli/config";
import { cloudflare, infra } from "alepha/cli/infra";

export default defineConfig({
  plugins: [infra({ environments: { production: cloudflare() } })],
});`;

  public addCloudflare(source: string): string {
    // TypeScript 7 supplies its AST through the native compiler API. Both
    // inputs are virtual files, so no config is imported or written to disk.
    const file = resolve(".alepha-infra-config/alepha.config.ts").replaceAll(
      "\\",
      "/",
    );
    const config = resolve(".alepha-infra-config/tsconfig.json").replaceAll(
      "\\",
      "/",
    );
    const api = new API({
      fs: createVirtualFileSystem({
        [file]: source,
        [config]: JSON.stringify({
          compilerOptions: { noLib: true, noResolve: true },
          files: ["alepha.config.ts"],
        }),
      }),
    });
    try {
      const snapshot = api.updateSnapshot({ openProjects: [config] });
      try {
        const project = snapshot.getProject(config);
        const tree = project?.program.getSourceFile(file);
        if (!tree || project?.program.getSyntacticDiagnostics(file).length)
          this.refuse("the file has syntax errors");
        return this.edit(tree, source);
      } finally {
        snapshot.dispose();
      }
    } finally {
      api.close();
    }
  }

  protected edit(tree: ts.SourceFile, source: string): string {
    const bindings = new Map<string, Map<string, string>>();
    const infraModules = new Set<string>();
    const occupied = new Set<string>();
    const helpers = new Set<string>();
    const factories = new Set<string>();
    const configHelpers = new Set<string>();
    const importedOwners = new Set<string>();
    let infraImport: ts.NamedImports | undefined;
    for (const statement of tree.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const module = statement.moduleSpecifier.text;
        if (/^alepha\/cli\/platform(?:-lib)?$/.test(module))
          this.refuse("legacy platform imports must be migrated first");
        const clause = statement.importClause;
        if (clause?.name) occupied.add(clause.name.text);
        const names = clause?.namedBindings;
        if (names && ts.isNamespaceImport(names)) {
          occupied.add(names.name.text);
          if (
            module === "alepha/cli/infra" ||
            module === "alepha/cli/infra-lib"
          )
            infraModules.add(names.name.text);
        }
        if (!names || !ts.isNamedImports(names)) continue;
        const imported = bindings.get(module) ?? new Map<string, string>();
        bindings.set(module, imported);
        for (const item of names.elements) {
          occupied.add(item.name.text);
          if (
            clause?.phaseModifier !== ts.SyntaxKind.TypeKeyword &&
            !item.isTypeOnly
          ) {
            const exported = (item.propertyName ?? item.name).text;
            imported.set(exported, item.name.text);
            if (module === "alepha/cli/config" && exported === "defineConfig")
              configHelpers.add(item.name.text);
            if (module === "alepha/cli/infra" && exported === "infra")
              helpers.add(item.name.text);
            if (
              (module === "alepha/cli/infra" ||
                module === "alepha/cli/infra-lib") &&
              exported === "cloudflare"
            )
              factories.add(item.name.text);
            if (
              (module === "alepha/cli/infra" ||
                module === "alepha/cli/infra-lib") &&
              [
                "infra",
                "infraOptions",
                "AlephaCliInfraPlugin",
                "AlephaInfraLibPlugin",
              ].includes(exported)
            )
              importedOwners.add(item.name.text);
          }
        }
        if (
          module === "alepha/cli/infra" &&
          clause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
        ) {
          infraImport ??= names;
        }
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name))
            occupied.add(declaration.name.text);
        }
      } else if (
        (ts.isClassDeclaration(statement) ||
          ts.isFunctionDeclaration(statement)) &&
        statement.name
      )
        occupied.add(statement.name.text);
    }

    const exports = tree.statements.filter(ts.isExportAssignment);
    if (
      !configHelpers.size ||
      exports.length !== 1 ||
      exports[0]?.isExportEquals
    )
      this.refuse(
        "use an export-default defineConfig call imported from alepha/cli/config",
      );
    const call = exports[0].expression;
    if (
      !ts.isCallExpression(call) ||
      !ts.isIdentifier(call.expression) ||
      !configHelpers.has(call.expression.text) ||
      call.arguments.length !== 1 ||
      !ts.isObjectLiteralExpression(call.arguments[0])
    )
      this.refuse(
        "the default export must call defineConfig with one literal object",
      );
    const root = call.arguments[0];
    const fields = this.fields(root, true);
    const knownInfra = bindings.get("alepha/cli/infra");
    const library = bindings.get("alepha/cli/infra-lib");
    const ownerNames = new Set(importedOwners);
    // An identifier/callback holding infra() is still an indirect registration.
    let grew = true;
    while (grew) {
      grew = false;
      for (const statement of tree.statements) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (
              ts.isIdentifier(declaration.name) &&
              declaration.initializer &&
              !ownerNames.has(declaration.name.text) &&
              this.referencesOwner(
                declaration.initializer,
                ownerNames,
                infraModules,
              )
            ) {
              ownerNames.add(declaration.name.text);
              grew = true;
            }
          }
        } else if (
          (ts.isFunctionDeclaration(statement) ||
            ts.isClassDeclaration(statement)) &&
          statement.name &&
          !ownerNames.has(statement.name.text) &&
          this.referencesOwner(statement, ownerNames, infraModules)
        ) {
          ownerNames.add(statement.name.text);
          grew = true;
        }
      }
    }
    for (const [name, field] of fields) {
      if (
        name !== "plugins" &&
        this.referencesOwner(this.valueOf(field), ownerNames, infraModules)
      )
        this.refuse(
          "services-based or indirect infrastructure registration must be edited manually",
        );
    }
    const pluginField = fields.get("plugins");
    const plugins = pluginField && this.valueOf(pluginField);
    if (
      plugins &&
      (!ts.isArrayLiteralExpression(plugins) ||
        plugins.elements.some(ts.isSpreadElement))
    )
      this.refuse("plugins must be an array literal without spreads");
    const entries =
      plugins && ts.isArrayLiteralExpression(plugins) ? plugins.elements : [];
    const registrations: ts.CallExpression[] = [];
    for (const entry of entries) {
      if (
        ts.isCallExpression(entry) &&
        ts.isIdentifier(entry.expression) &&
        helpers.has(entry.expression.text)
      )
        registrations.push(entry);
      else if (this.referencesOwner(entry, ownerNames, infraModules))
        this.refuse("indirect infrastructure registration is ambiguous");
    }
    if (registrations.length > 1)
      this.refuse(
        "multiple infra registrations would replace the same environment store",
      );
    if (registrations.length === 1) {
      this.canonical(registrations[0]!, factories);
      return source;
    }

    const edits: ConfigTextEdit[] = [];
    const infraName =
      knownInfra?.get("infra") ?? this.availableName("infra", occupied);
    occupied.add(infraName);
    const cloudflareName =
      knownInfra?.get("cloudflare") ??
      library?.get("cloudflare") ??
      this.availableName("cloudflare", occupied);
    const imports: string[] = [];
    if (!knownInfra?.has("infra"))
      imports.push(infraName === "infra" ? "infra" : `infra as ${infraName}`);
    if (!knownInfra?.has("cloudflare") && !library?.has("cloudflare"))
      imports.push(
        cloudflareName === "cloudflare"
          ? "cloudflare"
          : `cloudflare as ${cloudflareName}`,
      );
    if (imports.length) {
      if (infraImport)
        this.append(
          infraImport.elements,
          infraImport.getEnd() - 1,
          imports.join(", ") + ",",
          edits,
        );
      else
        edits.push({
          start: 0,
          text: `import { ${imports.join(", ")} } from "alepha/cli/infra";\n`,
        });
    }
    const registration = `${infraName}({ environments: { production: ${cloudflareName}() } })`;
    if (plugins && ts.isArrayLiteralExpression(plugins))
      this.append(
        plugins.elements,
        plugins.getEnd() - 1,
        registration + ",",
        edits,
      );
    else
      this.append(
        root.properties,
        root.getEnd() - 1,
        `plugins: [${registration}],`,
        edits,
      );
    for (const edit of edits.sort((a, b) => b.start - a.start))
      source =
        source.slice(0, edit.start) + edit.text + source.slice(edit.start);
    return source;
  }

  protected canonical(call: ts.CallExpression, factories: Set<string>): void {
    if (
      call.arguments.length !== 1 ||
      !ts.isObjectLiteralExpression(call.arguments[0])
    )
      this.refuse("infra options must be a literal object");
    const options = this.fields(call.arguments[0]);
    for (const [name, field] of options) {
      if (name !== "environments" && !this.literal(this.valueOf(field)))
        this.refuse("infra options must not be dynamic");
    }
    const environmentField = options.get("environments");
    const environments = environmentField && this.valueOf(environmentField);
    if (!environments || !ts.isObjectLiteralExpression(environments))
      this.refuse("environments must be a literal object");
    const descriptors = this.fields(environments);
    const productionField = descriptors.get("production");
    const production = productionField && this.valueOf(productionField);
    if (
      !production ||
      !ts.isCallExpression(production) ||
      !ts.isIdentifier(production.expression) ||
      !factories.has(production.expression.text)
    )
      this.refuse(
        "existing production infrastructure is not the imported Cloudflare factory; no provider conversion is performed",
      );
    if (
      production.arguments.length > 1 ||
      (production.arguments.length === 1 &&
        !ts.isObjectLiteralExpression(production.arguments[0]!))
    )
      this.refuse("Cloudflare options must be a literal object");
    for (const descriptor of descriptors.values()) {
      const value = this.valueOf(descriptor);
      if (
        !ts.isCallExpression(value) ||
        !ts.isIdentifier(value.expression) ||
        value.arguments.length > 1 ||
        value.arguments.some((argument) => !this.literal(argument))
      )
        this.refuse(
          "environment descriptors and their options must be literal factory calls",
        );
    }
  }

  protected fields(
    object: ts.ObjectLiteralExpression,
    allowShorthand = false,
  ): Map<string, ts.PropertyAssignment | ts.ShorthandPropertyAssignment> {
    const fields = new Map<
      string,
      ts.PropertyAssignment | ts.ShorthandPropertyAssignment
    >();
    for (const property of object.properties) {
      if (
        (!ts.isPropertyAssignment(property) &&
          !(allowShorthand && ts.isShorthandPropertyAssignment(property))) ||
        (!ts.isIdentifier(property.name) &&
          !ts.isStringLiteral(property.name) &&
          !ts.isNumericLiteral(property.name))
      )
        this.refuse(
          "computed, spread, shorthand or method configuration is unsupported",
        );
      const name = property.name.text;
      if (fields.has(name))
        this.refuse(`duplicate ${name} properties are ambiguous`);
      fields.set(name, property);
    }
    return fields;
  }

  protected valueOf(
    property: ts.PropertyAssignment | ts.ShorthandPropertyAssignment,
  ): ts.Expression {
    if (ts.isPropertyAssignment(property)) return property.initializer;
    if (ts.isIdentifier(property.name)) return property.name;
    return this.refuse("unsupported shorthand property");
  }

  protected literal(node: ts.Node): boolean {
    if (
      ts.isStringLiteral(node) ||
      ts.isNumericLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      [
        ts.SyntaxKind.TrueKeyword,
        ts.SyntaxKind.FalseKeyword,
        ts.SyntaxKind.NullKeyword,
      ].includes(node.kind)
    )
      return true;
    if (ts.isPrefixUnaryExpression(node))
      return (
        (node.operator === ts.SyntaxKind.MinusToken ||
          node.operator === ts.SyntaxKind.PlusToken) &&
        ts.isNumericLiteral(node.operand)
      );
    if (ts.isArrayLiteralExpression(node))
      return node.elements.every((entry) => this.literal(entry));
    if (ts.isObjectLiteralExpression(node))
      return [...this.fields(node).values()].every((field) =>
        this.literal(this.valueOf(field)),
      );
    return false;
  }

  protected referencesOwner(
    node: ts.Node,
    names: Set<string>,
    namespaces: Set<string>,
  ): boolean {
    if (
      ts.isIdentifier(node) &&
      (names.has(node.text) || namespaces.has(node.text))
    )
      return true;
    return (
      node.forEachChild(
        (child) => this.referencesOwner(child, names, namespaces) || undefined,
      ) ?? false
    );
  }

  protected append(
    nodes: ts.NodeArray<ts.Node>,
    close: number,
    text: string,
    edits: ConfigTextEdit[],
  ): void {
    const comma = nodes.length && !nodes.hasTrailingComma;
    const lastEnd = nodes[nodes.length - 1]?.getEnd();
    if (comma && lastEnd !== close) edits.push({ start: lastEnd!, text: "," });
    edits.push({
      start: close,
      text: `${comma && lastEnd === close ? "," : ""}\n  ${text}\n`,
    });
  }

  protected availableName(name: string, occupied: Set<string>): string {
    if (!occupied.has(name)) return name;
    const base = `alepha${name[0]!.toUpperCase()}${name.slice(1)}`;
    let candidate = base;
    let suffix = 2;
    while (occupied.has(candidate)) candidate = `${base}${suffix++}`;
    return candidate;
  }

  protected refuse(reason: string): never {
    throw new AlephaError(
      `Cannot safely add Cloudflare infrastructure: ${reason}. Migrate legacy platform imports/helpers to infra first, or add the canonical configuration manually without duplicating an existing registration:\n\n${this.manualConfig}`,
    );
  }
}

interface ConfigTextEdit {
  start: number;
  text: string;
}
