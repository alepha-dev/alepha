import type {
  DevActionMetadata,
  DevEntityMetadata,
  DevEnvMetadata,
  DevJobMetadata,
  DevPageMetadata,
  DevTopicMetadata,
} from "alepha/inspector";

/**
 * A `$route`, as `alepha docs --app` lists it. The inspector has no route
 * metadata of its own, so the command reads the primitives directly.
 */
export interface AppMapRoute {
  method: string;
  path: string;
}

/**
 * What the user's app registers, as `alepha docs --app` collects it: the
 * inspector's own metadata (`DevToolsMetadataProvider`), plus the routes.
 */
export interface AppMapInput {
  name: string;
  actions: DevActionMetadata[];
  entities: DevEntityMetadata[];
  pages: DevPageMetadata[];
  routes: AppMapRoute[];
  jobs: DevJobMetadata[];
  topics: DevTopicMetadata[];
  envs: DevEnvMetadata[];
}

/**
 * Renders the map of a user's app as markdown, for `alepha docs --app`
 * (#Q2759).
 *
 * Schemas are written as TypeScript-like types (`{ id: string; name?:
 * string }`) rather than JSON Schema: an agent reads them in a third of the
 * space, and the source of truth is a `z.object` it can open anyway.
 *
 * ⚠️ The environment section lists variables, their types and defaults,
 * never their values. `DevEnvMetadata.values` carries the live values,
 * secrets included, and this output is meant to be pasted into a model.
 */
export class AppMapRenderer {
  /**
   * The sections in print order, and what `alepha docs --app <section>`
   * accepts.
   */
  public readonly sections = [
    "actions",
    "entities",
    "pages",
    "routes",
    "jobs",
    "topics",
    "env",
  ] as const;

  /**
   * How deep a schema is spelled out before it becomes `{ ... }`.
   */
  protected readonly maxDepth = 3;

  /**
   * With no section, an overview: every section, one line per item and no
   * schemas, so a large app still fits in a prompt. With a section, that
   * section in full. `filter` keeps only the items whose text contains it,
   * case-insensitively: Lore's actions in full are 257 KB, and
   * `--app actions --grep quest` is what an agent editing quests wants.
   */
  public render(input: AppMapInput, only?: string, filter?: string): string {
    const detail = !!only;
    const sections = only
      ? this.sections.filter((section) => section === only)
      : this.sections;
    const counts = {
      actions: input.actions.filter((action) => !action.hide).length,
      entities: input.entities.length,
      pages: input.pages.length,
      routes: input.routes.length,
      jobs: input.jobs.length,
      topics: input.topics.length,
      env: this.envVariables(input.envs).length,
    };

    const lines: string[] = [
      `# ${input.name}: app map`,
      "",
      "What this app registers, read from its container by `alepha docs --app`.",
      `Sections: ${this.sections.map((s) => `${s} (${counts[s]})`).join(", ")}.`,
      detail
        ? `This is the \`${only}\` section in full.`
        : "This is the overview. Print a section in full, schemas and columns included, with `npx alepha docs --app <section>`.",
    ];

    for (const section of sections) {
      const rendered = this.renderSection(section, input, detail);
      lines.push("", ...(filter ? this.filter(rendered, filter) : rendered));
    }
    return lines.join("\n");
  }

  protected renderSection(
    section: (typeof this.sections)[number],
    input: AppMapInput,
    detail: boolean,
  ): string[] {
    switch (section) {
      case "actions":
        return detail
          ? this.renderActions(input.actions)
          : this.renderActionsOverview(input.actions);
      case "entities":
        return detail
          ? this.renderEntities(input.entities)
          : this.renderEntitiesOverview(input.entities);
      case "pages":
        return this.renderPages(input.pages);
      case "routes":
        return this.renderRoutes(input.routes);
      case "jobs":
        return this.renderJobs(input.jobs);
      case "topics":
        return this.renderTopics(input.topics);
      case "env":
        return this.renderEnv(input.envs);
    }
  }

  protected renderActions(actions: DevActionMetadata[]): string[] {
    const visible = actions
      .filter((action) => !action.hide)
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    const lines = [`## Actions (${visible.length})`];
    for (const action of visible) {
      const flags = [
        action.secure ? "secure" : undefined,
        action.disabled ? "disabled" : undefined,
      ].filter(Boolean);
      lines.push(
        "",
        `### ${action.method} ${action.fullPath}`,
        "",
        `\`${action.group}.${action.name}\`${flags.length ? ` (${flags.join(", ")})` : ""}${
          action.description || action.summary
            ? `: ${action.description ?? action.summary}`
            : ""
        }`,
      );
      for (const part of ["params", "query", "body", "response"] as const) {
        if (action[part]) {
          lines.push(`- ${part}: \`${this.type(action[part])}\``);
        }
      }
    }
    return lines;
  }

  /**
   * Keep the items of one rendered section that contain `text`, and recount
   * its `## Title (n)` heading. An item is a `### ` block when the section has
   * them, else a `- ` line, else a table row below the `| --- |` separator.
   */
  protected filter(lines: string[], text: string): string[] {
    const needle = text.toLowerCase();
    const kind = lines.some((line) => line.startsWith("### "))
      ? "block"
      : lines.some((line) => line.startsWith("- "))
        ? "list"
        : "table";
    const head: string[] = [];
    const items: string[][] = [];
    let inTable = false;
    for (const line of lines) {
      const starts =
        (kind === "block" && line.startsWith("### ")) ||
        (kind === "list" && line.startsWith("- ")) ||
        (kind === "table" && inTable && line.startsWith("| "));
      if (kind === "table" && line.startsWith("| ---")) inTable = true;
      if (starts) {
        items.push([line]);
      } else if (items.length && kind === "block") {
        items[items.length - 1].push(line);
      } else if (!items.length) {
        head.push(line);
      }
    }
    const kept = items.filter((item) =>
      item.join("\n").toLowerCase().includes(needle),
    );
    head[0] = head[0].replace(
      /\(\d+\)$/,
      `(${kept.length} matching "${text}")`,
    );
    return [...head, ...kept.flat()];
  }

  protected renderActionsOverview(actions: DevActionMetadata[]): string[] {
    const visible = actions
      .filter((action) => !action.hide)
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    const lines = [`## Actions (${visible.length})`, ""];
    for (const action of visible) {
      const about = action.description ?? action.summary;
      lines.push(
        `- ${action.method} \`${action.fullPath}\` \`${action.group}.${action.name}\`${action.secure ? " (secure)" : ""}${about ? `: ${about}` : ""}`,
      );
    }
    return lines;
  }

  protected renderEntitiesOverview(entities: DevEntityMetadata[]): string[] {
    const lines = [`## Entities (${entities.length})`, ""];
    for (const entity of [...entities].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      lines.push(
        `- \`${entity.name}\`: ${entity.columns.map((column) => column.name).join(", ")}`,
      );
    }
    return lines;
  }

  protected renderEntities(entities: DevEntityMetadata[]): string[] {
    const lines = [`## Entities (${entities.length})`];
    for (const entity of [...entities].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      lines.push(
        "",
        `### ${entity.name}`,
        "",
        "| column | type | notes |",
        "| --- | --- | --- |",
      );
      for (const column of entity.columns) {
        const notes = [
          column.primaryKey ? "primary key" : undefined,
          column.nullable ? "nullable" : undefined,
          column.hasDefault ? "default" : undefined,
          column.createdAt ? "createdAt" : undefined,
          column.updatedAt ? "updatedAt" : undefined,
          column.deletedAt ? "deletedAt" : undefined,
          column.version ? "version" : undefined,
          column.ref
            ? `-> ${column.ref.entity}.${column.ref.column}`
            : undefined,
        ].filter(Boolean);
        lines.push(`| ${column.name} | ${column.type} | ${notes.join(", ")} |`);
      }
      const unique = entity.indexes.filter((index) => index.unique);
      if (unique.length) {
        lines.push(
          "",
          `Unique: ${unique.map((index) => `(${index.columns.join(", ")})`).join(", ")}`,
        );
      }
    }
    return lines;
  }

  protected renderPages(pages: DevPageMetadata[]): string[] {
    const lines = [`## Pages (${pages.length})`, ""];
    for (const page of pages) {
      const traits = [
        page.parentName ? `in ${page.parentName}` : undefined,
        page.static ? "static" : undefined,
        page.hasResolve ? "loader" : undefined,
        page.params ? `params ${this.type(page.params)}` : undefined,
        page.query ? `query ${this.type(page.query)}` : undefined,
      ].filter(Boolean);
      lines.push(
        `- \`${page.name}\` ${page.path ? `\`${page.path}\`` : "(layout)"}${
          traits.length ? ` - ${traits.join(", ")}` : ""
        }${page.description ? `: ${page.description}` : ""}`,
      );
    }
    return lines;
  }

  protected renderRoutes(routes: AppMapRoute[]): string[] {
    const lines = [`## Routes (${routes.length})`, ""];
    for (const route of [...routes].sort((a, b) =>
      a.path.localeCompare(b.path),
    )) {
      lines.push(`- ${route.method} \`${route.path}\``);
    }
    return lines;
  }

  protected renderJobs(jobs: DevJobMetadata[]): string[] {
    const lines = [`## Jobs (${jobs.length})`, ""];
    for (const job of jobs) {
      const how =
        job.mode === "cron" ? `cron \`${job.cron}\`` : `${job.mode} mode`;
      const payload = job.schema
        ? `, payload \`${this.type(job.schema)}\``
        : "";
      lines.push(
        `- \`${job.name}\` (${how}${payload})${job.description ? `: ${job.description}` : ""}`,
      );
    }
    return lines;
  }

  protected renderTopics(topics: DevTopicMetadata[]): string[] {
    const lines = [`## Topics (${topics.length})`, ""];
    for (const topic of topics) {
      const payload = topic.schema
        ? `, payload \`${this.type(topic.schema)}\``
        : "";
      lines.push(
        `- \`${topic.name}\` (${topic.provider}, ${topic.subscribers} subscribers${payload})${
          topic.description ? `: ${topic.description}` : ""
        }`,
      );
    }
    return lines;
  }

  protected renderEnv(envs: DevEnvMetadata[]): string[] {
    const variables = this.envVariables(envs);
    const lines = [
      `## Environment (${variables.length})`,
      "",
      "Names, types and defaults only; values are never printed.",
      "",
      "| variable | type | default | declared by |",
      "| --- | --- | --- | --- |",
    ];
    for (const v of variables) {
      lines.push(
        `| ${v.name}${v.required ? "" : "?"} | ${v.type} | ${v.default ?? ""} | ${v.owner} |`,
      );
    }
    return lines;
  }

  /**
   * One row per variable, deduplicated by name: two services reading the
   * same variable declare it twice.
   */
  protected envVariables(envs: DevEnvMetadata[]): Array<{
    name: string;
    type: string;
    default?: string;
    required: boolean;
    owner: string;
  }> {
    const seen = new Map<
      string,
      {
        name: string;
        type: string;
        default?: string;
        required: boolean;
        owner: string;
      }
    >();
    for (const env of envs) {
      const properties: Record<string, any> = env.schema?.properties ?? {};
      const required = new Set<string>(env.schema?.required ?? []);
      for (const [name, schema] of Object.entries(properties)) {
        if (seen.has(name)) continue;
        seen.set(name, {
          name,
          type: this.type(schema),
          default:
            schema?.default === undefined
              ? undefined
              : `\`${JSON.stringify(schema.default)}\``,
          required: required.has(name) && schema?.default === undefined,
          owner: env.serviceName ?? env.moduleName ?? "",
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * A JSON Schema as a TypeScript-like type, spelled out to {@link maxDepth}.
   */
  public type(schema: any, depth = 0): string {
    if (!schema || typeof schema !== "object") {
      return "unknown";
    }
    if (schema.const !== undefined) {
      return JSON.stringify(schema.const);
    }
    if (Array.isArray(schema.enum)) {
      return schema.enum.map((v: unknown) => JSON.stringify(v)).join(" | ");
    }
    const union = schema.anyOf ?? schema.oneOf;
    if (Array.isArray(union)) {
      return union.map((s: any) => this.type(s, depth)).join(" | ");
    }
    if (Array.isArray(schema.type)) {
      return schema.type
        .map((t: string) => this.type({ ...schema, type: t }, depth))
        .join(" | ");
    }
    switch (schema.type) {
      case "string":
        return schema.format ? `string (${schema.format})` : "string";
      case "integer":
      case "number":
        return "number";
      case "boolean":
        return "boolean";
      case "null":
        return "null";
      case "array":
        return `${this.wrap(this.type(schema.items, depth + 1))}[]`;
      case "object": {
        const properties: Record<string, any> = schema.properties ?? {};
        const keys = Object.keys(properties);
        if (!keys.length) {
          return schema.additionalProperties
            ? `Record<string, ${this.type(schema.additionalProperties, depth + 1)}>`
            : "{}";
        }
        if (depth >= this.maxDepth) {
          return "{ ... }";
        }
        const required = new Set<string>(schema.required ?? []);
        const fields = keys.map(
          (key) =>
            `${key}${required.has(key) ? "" : "?"}: ${this.type(properties[key], depth + 1)}`,
        );
        return `{ ${fields.join("; ")} }`;
      }
      default:
        return "unknown";
    }
  }

  protected wrap(type: string): string {
    return type.includes(" | ") ? `(${type})` : type;
  }
}
