import type { AppSurface } from "alepha";
import type * as vite from "vite";

/**
 * Takes a pure controller's code out of the eager server bundle (#Q3407).
 *
 * A module file names its controllers by a static import and lists them in
 * `services` (or passes them to `alepha.with`). As long as that import
 * stands, the bundler keeps the controller in the eager closure, whatever
 * the container does. Given the build list, this rewrites such an import into
 * a lazy declaration: `lazyService(name, () => import(...))`, which the
 * container declares by key and imports on the class's first use. Authors
 * write nothing new.
 *
 * Only a binding used nowhere else in the file is rewritten, and only for a
 * class the list calls pure that holds no page, no MCP tool and no `mcp`
 * action: those are created by synchronous paths (a page lookup, the MCP
 * listing) that cannot wait for an import. A class some other file imports
 * statically stays in the eager closure all the same; {@link eagerReport}
 * names it and the file importing it.
 */
export class LazyControllerPlugin {
  /**
   * The rewritten imports, by the resolved id of the controller's file.
   */
  protected readonly rewritten = new Map<
    string,
    { key: string; name: string; from: string }
  >();

  /**
   * After a build: each rewritten controller whose code stayed in the eager
   * closure, with the files importing it statically.
   */
  public eagerReport: Array<{ key: string; importers: string[] }> = [];

  public create(surface: AppSurface): vite.Plugin {
    const lazyable = this.lazyable(surface);
    this.rewritten.clear();
    this.eagerReport = [];
    // The bundler calls the hooks with its own `this`; the plugin's state is
    // reached through these closures.
    const plan = (ast: any) => this.plan(ast, lazyable);
    const rewrite = (code: string, items: LazyImportPlan[]) =>
      this.rewrite(code, items);
    const record = (
      id: string,
      entry: { key: string; name: string; from: string },
    ) => this.rewritten.set(id, entry);
    const report = (context: any, bundle: Record<string, any>) => {
      this.eagerReport = this.eagerOf(context, bundle);
    };

    return {
      name: "alepha:lazy-controllers",
      enforce: "post",
      async transform(code, id) {
        if (!code.includes("$module(") && !code.includes(".with(")) {
          return null;
        }
        const ast = (this as any).parse(code);
        const items = plan(ast);
        if (items.length === 0) {
          return null;
        }
        for (const it of items) {
          const resolved = await (this as any).resolve(it.source, id);
          if (resolved?.id) {
            record(resolved.id, { key: it.key, name: it.name, from: id });
          }
        }
        return { code: rewrite(code, items), map: null };
      },
      generateBundle(_options, bundle) {
        report(this, bundle);
      },
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The class keys that may be imported lazily.
   */
  protected lazyable(surface: AppSurface): Set<string> {
    const excluded = new Set<string>([
      ...surface.pages.map((it) => it.class),
      ...surface.tools.map((it) => it.class),
      ...surface.resources.map((it) => it.class),
      ...surface.prompts.map((it) => it.class),
      ...surface.actions.filter((it) => it.mcp).map((it) => it.class),
    ]);
    return new Set(
      surface.classes
        .filter((it) => it.pure && !excluded.has(it.key))
        .map((it) => it.key),
    );
  }

  /**
   * Which imports of this module file can be rewritten, and how.
   */
  public plan(ast: any, lazyable: Set<string>): LazyImportPlan[] {
    // Imported bindings from relative files, by local name.
    const imports = new Map<
      string,
      { imported: string; source: string; decl: any; spec: any }
    >();
    for (const node of ast.body) {
      if (
        node.type !== "ImportDeclaration" ||
        node.importKind === "type" ||
        typeof node.source?.value !== "string" ||
        !node.source.value.startsWith(".")
      ) {
        continue;
      }
      for (const spec of node.specifiers ?? []) {
        if (spec.type !== "ImportSpecifier" || spec.importKind === "type") {
          continue;
        }
        imports.set(spec.local.name, {
          imported: spec.imported.name ?? spec.imported.value,
          source: node.source.value,
          decl: node,
          spec,
        });
      }
    }
    if (imports.size === 0) {
      return [];
    }

    // Every reference to those bindings, and whether it is an allowed one.
    const uses = new Map<
      string,
      { allowed: number; other: number; key?: string }
    >();
    const visit = (node: any, parents: any[]) => {
      if (!node || typeof node.type !== "string") {
        return;
      }
      if (node.type === "Identifier" && imports.has(node.name)) {
        const parent = parents[parents.length - 1];
        if (parent?.type === "ImportSpecifier") {
          return;
        }
        const use = uses.get(node.name) ?? { allowed: 0, other: 0 };
        const key = this.allowedKey(
          node,
          parents,
          imports.get(node.name)!.imported,
        );
        if (key) {
          use.allowed++;
          use.key = key;
        } else {
          use.other++;
        }
        uses.set(node.name, use);
        return;
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const child of value) visit(child, [...parents, node]);
        } else if (value && typeof value === "object" && "type" in value) {
          visit(value, [...parents, node]);
        }
      }
    };
    visit(ast, []);

    const plan: LazyImportPlan[] = [];
    for (const [local, use] of uses) {
      const it = imports.get(local)!;
      if (
        use.other > 0 ||
        use.allowed === 0 ||
        !use.key ||
        local !== it.imported
      ) {
        continue;
      }
      if (!lazyable.has(use.key)) {
        continue;
      }
      plan.push({
        local,
        name: it.imported,
        key: use.key,
        source: it.source,
        decl: it.decl,
        spec: it.spec,
      });
    }
    return plan;
  }

  /**
   * The class key a reference registers, when it is an allowed use: an
   * element of `$module({ services: [...] })`, or the one argument of
   * `x.with(...)`.
   */
  protected allowedKey(
    node: any,
    parents: any[],
    name: string,
  ): string | undefined {
    const parent = parents[parents.length - 1];
    if (
      parent?.type === "CallExpression" &&
      parent.arguments.length === 1 &&
      parent.arguments[0] === node &&
      parent.callee?.type === "MemberExpression" &&
      (parent.callee.property?.name ?? parent.callee.property?.value) === "with"
    ) {
      // `alepha.with(X)` tags nothing: the class is keyed by its name.
      return name;
    }
    if (parent?.type === "ArrayExpression") {
      const property = parents[parents.length - 2];
      const object = parents[parents.length - 3];
      const call = parents[parents.length - 4];
      if (
        property?.type === "Property" &&
        (property.key?.name ?? property.key?.value) === "services" &&
        object?.type === "ObjectExpression" &&
        call?.type === "CallExpression" &&
        call.callee?.type === "Identifier" &&
        call.callee.name === "$module"
      ) {
        const moduleName = object.properties.find(
          (it: any) => (it.key?.name ?? it.key?.value) === "name",
        )?.value?.value;
        return typeof moduleName === "string"
          ? `${moduleName}:${name}`
          : undefined;
      }
    }
    return undefined;
  }

  /**
   * The module file with each planned import replaced by a lazy declaration.
   */
  public rewrite(code: string, plan: LazyImportPlan[]): string {
    // Edits from the end, so earlier offsets stay valid.
    const edits: Array<{ start: number; end: number; text: string }> = [];
    const byDecl = new Map<any, LazyImportPlan[]>();
    for (const it of plan) {
      byDecl.set(it.decl, [...(byDecl.get(it.decl) ?? []), it]);
    }
    for (const [decl, items] of byDecl) {
      const kept = decl.specifiers.filter(
        (spec: any) => !items.some((it) => it.spec === spec),
      );
      const keptText = kept.map((spec: any) =>
        code.slice(spec.start, spec.end),
      );
      const text = keptText.length
        ? `import { ${keptText.join(", ")} } from ${JSON.stringify(decl.source.value)};`
        : "";
      edits.push({ start: decl.start, end: decl.end, text });
    }
    edits.sort((a, b) => b.start - a.start);
    let out = code;
    for (const edit of edits) {
      out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }
    const declarations = plan
      .map(
        (it) =>
          `const ${it.local} = __alephaLazyService(${JSON.stringify(it.name)}, () => import(${JSON.stringify(it.source)}).then((m) => m.${it.name}));`,
      )
      .join("\n");
    return `import { lazyService as __alephaLazyService } from "alepha";\n${declarations}\n${out}`;
  }

  /**
   * The rewritten controllers whose code is still in the eager closure, and
   * their static importers.
   */
  protected eagerOf(
    context: { getModuleInfo: (id: string) => any },
    bundle: Record<string, any>,
  ): Array<{ key: string; importers: string[] }> {
    const chunks = Object.values(bundle).filter((it) => it.type === "chunk");
    const entry = chunks.find((it) => it.isEntry);
    if (!entry) {
      return [];
    }
    const eagerFiles = new Set<string>();
    const seen = new Set<string>();
    const walk = (fileName: string) => {
      if (seen.has(fileName)) return;
      seen.add(fileName);
      const chunk = bundle[fileName];
      if (!chunk || chunk.type !== "chunk") return;
      for (const id of Object.keys(chunk.modules ?? {})) eagerFiles.add(id);
      for (const imported of chunk.imports ?? []) walk(imported);
    };
    walk(entry.fileName);

    const report: Array<{ key: string; importers: string[] }> = [];
    for (const [id, it] of this.rewritten) {
      if (!eagerFiles.has(id)) {
        continue;
      }
      const importers = (context.getModuleInfo(id)?.importers ?? []).filter(
        (file: string) => file !== it.from,
      );
      report.push({ key: it.key, importers });
    }
    return report;
  }
}

export interface LazyImportPlan {
  local: string;
  name: string;
  key: string;
  source: string;
  decl: any;
  spec: any;
}
