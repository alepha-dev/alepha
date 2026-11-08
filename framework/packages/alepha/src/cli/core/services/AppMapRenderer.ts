import type {
  DevActionMetadata,
  DevAtomMetadata,
  DevEntityMetadata,
  DevEnvMetadata,
  DevJobMetadata,
  DevModuleMetadata,
  DevPageMetadata,
  DevPermissionMetadata,
  DevRealmMetadata,
  DevRoleMetadata,
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
 * What the user's app registers: the inspector's own metadata
 * (`DevToolsMetadataProvider`), as `alepha docs --app` collects it from a
 * loaded container or `alepha mcp` reads it from a running app's `/metadata`.
 *
 * A section whose key is absent is left out of the map rather than shown
 * empty: the live `/metadata` has no routes.
 */
export interface AppMapInput {
  name: string;
  actions: DevActionMetadata[];
  entities: DevEntityMetadata[];
  pages: DevPageMetadata[];
  routes?: AppMapRoute[];
  jobs: DevJobMetadata[];
  topics: DevTopicMetadata[];
  modules?: DevModuleMetadata[];
  atoms?: DevAtomMetadata[];
  realms?: DevRealmMetadata[];
  roles?: DevRoleMetadata[];
  permissions?: DevPermissionMetadata[];
  envs: DevEnvMetadata[];
}

/**
 * One section of the map, by the name `alepha docs --app <section>` takes.
 */
export type AppMapSection = AppMapRenderer["sections"][number];

/**
 * Who printed the map, for its header: the source it was read from, and how
 * to print one section in full.
 */
export interface AppMapOrigin {
  /**
   * @example "read from its container by `alepha docs --app`"
   */
  source: string;
  /**
   * @example "with `npx alepha docs --app <section>`"
   */
  detail: string;
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
    "modules",
    "atoms",
    "realms",
    "roles",
    "permissions",
    "env",
  ] as const;

  /**
   * The kinds of item {@link describe} prints one of, by the section that
   * lists them.
   */
  public readonly kinds = {
    action: "actions",
    entity: "entities",
    page: "pages",
    job: "jobs",
    topic: "topics",
    module: "modules",
    atom: "atoms",
    realm: "realms",
    role: "roles",
    permission: "permissions",
  } as const;

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
  public render(
    input: AppMapInput,
    only?: string,
    filter?: string,
    origin: AppMapOrigin = {
      source: "read from its container by `alepha docs --app`",
      detail: "with `npx alepha docs --app <section>`",
    },
  ): string {
    const detail = !!only;
    const present = this.sections.filter((section) => this.has(input, section));
    const sections = only
      ? present.filter((section) => section === only)
      : present;

    const lines: string[] = [
      `# ${input.name}: app map`,
      "",
      `What this app registers, ${origin.source}.`,
      `Sections: ${present.map((s) => `${s} (${this.count(input, s)})`).join(", ")}.`,
      detail
        ? `This is the \`${only}\` section in full.`
        : `This is the overview. Print a section in full, schemas and columns included, ${origin.detail}.`,
    ];

    for (const section of sections) {
      const rendered = this.renderSection(section, input, detail);
      lines.push("", ...(filter ? this.filter(rendered, filter) : rendered));
    }
    return lines.join("\n");
  }

  /**
   * One item in full, by its kind and name, or `undefined` when none has
   * that name. An action is named `group.name`, by its bare name when that
   * is unique, or by its path (`/api/orders/:id`, `GET /api/orders/:id`); a
   * permission by its id or its name.
   */
  public describe(
    input: AppMapInput,
    kind: keyof typeof this.kinds,
    name: string,
  ): string | undefined {
    const found = this.find(input, kind, name);
    if (found.length !== 1) {
      return undefined;
    }
    const item = found[0] as any;
    switch (kind) {
      case "action":
        return this.renderActions([item]).slice(2).join("\n");
      case "entity":
        return this.renderEntities([item]).slice(2).join("\n");
      case "page":
        return this.renderPages([item]).slice(2).join("\n");
      case "job":
        return this.renderJobs([item], true).slice(2).join("\n");
      case "topic":
        return this.renderTopics([item]).slice(2).join("\n");
      case "module":
        return this.renderModules([item], true).slice(2).join("\n");
      case "atom":
        return this.renderAtoms([item], true).slice(2).join("\n");
      case "realm":
        return this.renderRealms([item]).slice(2).join("\n");
      case "role":
        return this.renderRoles([item], true).slice(2).join("\n");
      case "permission":
        return this.renderPermissions([item]).slice(2).join("\n");
    }
  }

  /**
   * The names of the items of a kind that contain `query`, for an answer to
   * a {@link describe} that found none or several.
   */
  public candidates(
    input: AppMapInput,
    kind: keyof typeof this.kinds,
    query: string,
    limit = 10,
  ): string[] {
    const needle = query.toLowerCase();
    return this.items(input, kind)
      .map((item) => this.names(kind, item)[0])
      .filter((name) => name.toLowerCase().includes(needle))
      .slice(0, limit);
  }

  protected find(
    input: AppMapInput,
    kind: keyof typeof this.kinds,
    name: string,
  ): unknown[] {
    const items = this.items(input, kind);
    const exact = items.filter((item) => this.names(kind, item).includes(name));
    return exact;
  }

  protected items(
    input: AppMapInput,
    kind: keyof typeof this.kinds,
  ): unknown[] {
    switch (kind) {
      case "action":
        return input.actions.filter((action) => !action.hide);
      case "entity":
        return input.entities;
      case "page":
        return input.pages;
      case "job":
        return input.jobs;
      case "topic":
        return input.topics;
      case "module":
        return input.modules ?? [];
      case "atom":
        return input.atoms ?? [];
      case "realm":
        return input.realms ?? [];
      case "role":
        return input.roles ?? [];
      case "permission":
        return input.permissions ?? [];
    }
  }

  /**
   * Every name an item answers to, its canonical one first.
   */
  protected names(kind: keyof typeof this.kinds, item: any): string[] {
    if (kind === "action") {
      return [
        `${item.group}.${item.name}`,
        item.name,
        item.fullPath,
        `${item.method} ${item.fullPath}`,
      ];
    }
    if (kind === "permission") {
      return [item.id, item.name];
    }
    return [item.name];
  }

  protected has(input: AppMapInput, section: AppMapSection): boolean {
    switch (section) {
      case "routes":
        return !!input.routes;
      case "modules":
      case "atoms":
      case "realms":
      case "roles":
      case "permissions":
        return !!input[section];
      default:
        return true;
    }
  }

  protected count(input: AppMapInput, section: AppMapSection): number {
    switch (section) {
      case "actions":
        return input.actions.filter((action) => !action.hide).length;
      case "env":
        return this.envVariables(input.envs).length;
      case "routes":
        return input.routes?.length ?? 0;
      default:
        return (input[section] ?? []).length;
    }
  }

  protected renderSection(
    section: AppMapSection,
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
        return this.renderRoutes(input.routes ?? []);
      case "jobs":
        return this.renderJobs(input.jobs, detail);
      case "topics":
        return this.renderTopics(input.topics);
      case "modules":
        return this.renderModules(input.modules ?? [], detail);
      case "atoms":
        return this.renderAtoms(input.atoms ?? [], detail);
      case "realms":
        return this.renderRealms(input.realms ?? []);
      case "roles":
        return this.renderRoles(input.roles ?? [], detail);
      case "permissions":
        return this.renderPermissions(input.permissions ?? []);
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
      const rule = this.secureRule(action);
      if (rule) {
        lines.push(`- secure: ${rule}`);
      }
      if (action.errors) {
        lines.push(
          `- errors: ${
            action.errors.length
              ? action.errors
                  .map((error) =>
                    error.status
                      ? `${error.name} (${error.status})`
                      : error.name,
                  )
                  .join(", ")
              : "none declared (strict)"
          }`,
        );
      }
    }
    return lines;
  }

  /**
   * What an action's `$secure` asks of the caller: a signed-in user, roles,
   * permissions. `undefined` when it has none.
   */
  protected secureRule(action: DevActionMetadata): string | undefined {
    const secure = action.middlewares?.find((m) => m.name === "$secure");
    if (!secure && !action.secure) {
      return undefined;
    }
    const options = (secure?.options ?? {}) as {
      roles?: string[];
      permissions?: Array<string | { group?: string; name: string }>;
    };
    const parts = ["a signed-in user"];
    if (options.roles?.length) {
      parts.push(`roles ${options.roles.join(", ")}`);
    }
    if (options.permissions?.length) {
      parts.push(
        `permissions ${options.permissions
          .map((it) =>
            typeof it === "string"
              ? it
              : [it.group, it.name].filter(Boolean).join(":"),
          )
          .join(", ")}`,
      );
    }
    return parts.join("; ");
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
          column.secret ? "secret" : undefined,
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

  protected renderJobs(jobs: DevJobMetadata[], detail = false): string[] {
    const lines = [`## Jobs (${jobs.length})`, ""];
    for (const job of jobs) {
      const how =
        job.mode === "cron" ? `cron \`${job.cron}\`` : `${job.mode} mode`;
      const payload = job.schema
        ? `, payload \`${this.type(job.schema)}\``
        : "";
      const extra = detail
        ? [
            job.timeout ? `timeout ${job.timeout}` : undefined,
            job.retries !== undefined ? `${job.retries} retries` : undefined,
            job.lock ? "locked" : undefined,
          ].filter(Boolean)
        : [];
      lines.push(
        `- \`${job.name}\` (${how}${payload}${extra.length ? `, ${extra.join(", ")}` : ""})${job.description ? `: ${job.description}` : ""}`,
      );
    }
    return lines;
  }

  protected renderModules(
    modules: DevModuleMetadata[],
    detail = false,
  ): string[] {
    const lines = [`## Modules (${modules.length})`, ""];
    for (const module of [...modules].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      lines.push(
        detail
          ? `- \`${module.name}\`: ${module.providers.join(", ")}`
          : `- \`${module.name}\` (${module.providers.length} providers)`,
      );
    }
    return lines;
  }

  /**
   * Atoms by key, with their type when in full. Never a value: an atom
   * marked `serverOnly` may hold a secret, and this output goes to a model.
   */
  protected renderAtoms(atoms: DevAtomMetadata[], detail = false): string[] {
    const lines = [`## Atoms (${atoms.length})`, ""];
    for (const atom of [...atoms].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const traits = [
        detail && atom.schema ? this.type(atom.schema) : undefined,
        atom.serverOnly ? "server only" : undefined,
        atom.persist ? `persisted in ${atom.persist}` : undefined,
      ].filter(Boolean);
      lines.push(
        `- \`${atom.name}\`${traits.length ? ` (${traits.join(", ")})` : ""}${atom.description ? `: ${atom.description}` : ""}`,
      );
    }
    return lines;
  }

  protected renderRealms(realms: DevRealmMetadata[]): string[] {
    const lines = [`## Realms (${realms.length})`, ""];
    for (const realm of realms) {
      const roles = (realm.roles ?? [])
        .map((role: any) => (typeof role === "string" ? role : role?.name))
        .filter(Boolean);
      lines.push(
        `- \`${realm.name}\` (${realm.type}${roles.length ? `, roles ${roles.join(", ")}` : ""})${realm.description ? `: ${realm.description}` : ""}`,
      );
    }
    return lines;
  }

  protected renderRoles(roles: DevRoleMetadata[], detail = false): string[] {
    const lines = [`## Roles (${roles.length})`, ""];
    for (const role of roles) {
      const traits = [
        role.realm ? `realm ${role.realm}` : undefined,
        role.default ? "default" : undefined,
        `${role.effective.length} permissions`,
      ].filter(Boolean);
      lines.push(
        `- \`${role.name}\` (${traits.join(", ")})${role.description ? `: ${role.description}` : ""}`,
      );
      if (detail) {
        lines.push(
          `  - grants: ${role.grants
            .map(
              (grant) =>
                `${grant.name}${grant.ownership ? " (own)" : ""}${grant.exclude?.length ? ` except ${grant.exclude.join(", ")}` : ""}`,
            )
            .join(", ")}`,
          `  - effective: ${role.effective.join(", ")}`,
        );
      }
    }
    return lines;
  }

  protected renderPermissions(permissions: DevPermissionMetadata[]): string[] {
    const lines = [`## Permissions (${permissions.length})`, ""];
    for (const permission of [...permissions].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      lines.push(
        `- \`${permission.id}\`${permission.description ? `: ${permission.description}` : ""}`,
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
