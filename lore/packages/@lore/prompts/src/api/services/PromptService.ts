import {
  AgentJobs,
  type BuiltinPrompt,
  ProjectRoster,
  ProjectSecurityService,
  type PromptArgItem,
  type PromptPage,
  PromptRegistry,
} from "@lore/core/api";
import {
  PROMPT_ARG_FIELDS,
  PROMPT_ARG_STATUSES,
  PROMPT_CHOICE_OPTION,
  PROMPT_CUSTOM_TIMEOUT_SECONDS,
  type Project,
  type PromptArg,
  type PromptResource,
  promptPlaceholders,
  renderPromptText,
  projects,
} from "@lore/core/schemas";
import { $inject, Alepha } from "alepha";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";

import { type Prompt, prompts } from "../entities/prompts.ts";
import type { PromptCreate } from "../schemas/promptCreateSchema.ts";
import type { PromptWrite } from "../schemas/promptWriteSchema.ts";
import { PromptTriggers } from "./PromptTriggers.ts";

/**
 * A project's prompts (#E174, #Q4274): the built-ins of the registry merged
 * with the project's rows, and its custom prompts.
 *
 * - **A built-in's words are frozen.** Its title, description, text and
 *   args are refused on write; its source, ref, host, agent, model and
 *   enabled are writable, and writing one creates its row. To change the
 *   words, duplicate it.
 * - **Render** fills a prompt's args, each read with the caller's own
 *   permissions, and refuses an item whose status its arg does not accept:
 *   what Copy uses, and what a run renders before it starts.
 *
 * Who may call what is the controller's (every member reads and renders,
 * `prompt:manage` writes); this checks what a row may hold.
 */
export class PromptService {
  protected readonly alepha = $inject(Alepha);
  protected readonly rows = $repository(prompts);
  protected readonly projects = $repository(projects);
  protected readonly registry = $inject(PromptRegistry);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly roster = $inject(ProjectRoster);
  protected readonly agents = $inject(AgentJobs);

  constructor() {
    // A pull request is a number in the project's repository, recorded on a
    // quest or not, filled as a review of it has always been.
    this.registry.registerArg({
      type: "pullRequest",
      permission: "quest:read",
      resolve: async ({ project, value }) => {
        const number = PromptService.numberOf(value);
        if (number === undefined) return undefined;
        const repository = (project.repositoryUrl ?? "").replace(/\/+$/, "");
        return {
          fields: {
            number,
            id: number,
            url: repository ? `${repository}/pull/${number}` : "",
            reference: `pull request #${number}`,
            title: `pull request #${number}`,
          },
        };
      },
    });
    this.registry.registerOptions("member", async (projectId) =>
      (await this.roster.of(projectId)).map((it) => ({
        value: it.userId,
        label: it.label,
      })),
    );
    // A member of the project, by id or by name.
    this.registry.registerArg({
      type: "member",
      permission: "project:read",
      resolve: async ({ project, value }) => {
        const wanted = value.trim().replace(/^@/, "").toLowerCase();
        const member = (await this.roster.of(project.id)).find(
          (it) =>
            it.userId === value.trim() ||
            it.name.toLowerCase() === wanted ||
            it.label.toLowerCase() === wanted,
        );
        return member
          ? { fields: { name: member.label, id: member.userId } }
          : undefined;
      },
    });
  }

  /**
   * The digits of `12`, `#12`, `#Q12` or `P12`.
   */
  public static numberOf(value: string): number | undefined {
    const match = /^#?[A-Za-z]?(\d{1,9})$/.exec(value.trim());
    return match ? Number(match[1]) : undefined;
  }

  /**
   * What an arg's select lists (#Q4280), read with the caller's permission
   * on the item type: only items whose status the arg accepts.
   */
  public async argOptions(
    projectId: number,
    user: UserAccountToken,
    name: string,
    argName: string,
  ): Promise<Array<{ value: string; label: string }>> {
    const prompt = await this.get(projectId, name);
    const arg = prompt.args.find((it) => it.name === argName);
    if (!arg) throw new NotFoundError(`The prompt has no arg '${argName}'`);
    // A choice lists its own options, and reads nothing (#Q4415).
    if (arg.type === "choice") {
      return (arg.accepts ?? []).map((it) => ({ value: it, label: it }));
    }
    const resolver = this.registry.arg(arg.type);
    if (
      !resolver ||
      !(await this.security.holds(projectId, user.id, resolver.permission))
    ) {
      return [];
    }
    return (
      (await this.registry.options(arg.type)?.(projectId, arg.accepts)) ?? []
    );
  }

  /**
   * The built-ins first, in registration order, then the custom prompts by
   * name. A built-in the project cannot use (`needs`) is left out.
   */
  public async list(projectId: number): Promise<PromptResource[]> {
    const rows = await this.rows.findMany({
      where: { projectId: { eq: projectId } },
    });
    const byName = new Map(rows.map((row) => [row.name, row]));
    const builtins = (await this.usable(projectId)).map((builtin) =>
      this.toResource(builtin, byName.get(builtin.name)),
    );
    const custom = rows
      .filter((row) => !row.builtin)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => this.toResource(undefined, row));
    return [...builtins, ...custom];
  }

  /**
   * The run time a project set on a prompt (#Q4344), or undefined when it
   * set none: a run then takes what the built-in plans.
   */
  public async timeoutSet(
    projectId: number,
    name: string,
  ): Promise<number | undefined> {
    const row = await this.rowOf(projectId, name);
    return row?.timeoutSeconds ?? undefined;
  }

  public async get(projectId: number, name: string): Promise<PromptResource> {
    const { builtin, row } = await this.find(projectId, name);
    return this.toResource(builtin, row);
  }

  public async create(
    projectId: number,
    user: UserAccountToken,
    body: PromptCreate,
  ): Promise<PromptResource> {
    if (this.registry.get(body.name)) {
      throw new ConflictError(
        `'${body.name}' is a built-in prompt's name: duplicate it to change its words`,
      );
    }
    if (await this.rowOf(projectId, body.name)) {
      throw new ConflictError(
        `A prompt named '${body.name}' already exists here`,
      );
    }
    const args = body.args ?? [];
    this.assertArgs(args);
    this.assertPlaceholders(body.text, args);
    await this.assertWhere(projectId, body);
    const row = await this.rows.create({
      projectId,
      name: body.name,
      createdBy: user.id,
      title: body.title ?? body.name,
      ...(body.description ? { description: body.description } : {}),
      text: body.text,
      args,
      source: body.source ?? "read",
      ...this.wherePatch(body),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      ...(typeof body.timeoutSeconds === "number"
        ? { timeoutSeconds: body.timeoutSeconds }
        : {}),
      ...(body.concurrency ? { concurrency: body.concurrency } : {}),
    });
    return this.toResource(undefined, row);
  }

  /**
   * Only the fields given change. On a built-in, writing creates its row.
   */
  public async update(
    projectId: number,
    user: UserAccountToken,
    name: string,
    body: PromptWrite,
  ): Promise<PromptResource> {
    const { builtin, row } = await this.find(projectId, name);
    if (builtin) {
      const frozen = (
        ["title", "description", "text", "args", "concurrency"] as const
      )
        .filter((key) => body[key] !== undefined)
        .join(", ");
      if (frozen) {
        throw new BadRequestError(
          `'${name}' is a built-in prompt: its ${frozen} cannot change. Duplicate it to write your own words`,
        );
      }
    } else {
      const args = body.args ?? row!.args ?? [];
      if (body.args) this.assertArgs(args);
      if (body.text !== undefined || body.args !== undefined) {
        this.assertPlaceholders(body.text ?? row!.text ?? "", args);
      }
    }
    await this.assertWhere(projectId, body);
    const patch: Record<string, unknown> = {
      ...this.wherePatch(body),
      ...(body.source === undefined ? {} : { source: body.source }),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      ...(body.pins === undefined
        ? {}
        : { pins: await this.pinsOf(projectId, body.pins) }),
      ...(body.timeoutSeconds === undefined
        ? {}
        : { timeoutSeconds: body.timeoutSeconds ?? null }),
      // Its trigger (#Q4277), checked against its args. Resolved here: the
      // triggers read this service.
      ...this.alepha
        .inject(PromptTriggers)
        .patch(this.toResource(builtin, row), row, body),
    };
    // A trigger runs as its owner: whoever set it last owns it.
    if (
      body.on !== undefined ||
      body.argValues !== undefined ||
      body.check !== undefined
    ) {
      patch.createdBy = user.id;
    }
    if (!builtin) {
      for (const key of [
        "title",
        "description",
        "text",
        "args",
        "concurrency",
      ] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
    }
    if (!row) {
      const created = await this.rows.create({
        projectId,
        name,
        builtin: true,
        createdBy: user.id,
        ...(patch as Partial<Prompt>),
      });
      return this.toResource(builtin, created);
    }
    const updated = Object.keys(patch).length
      ? await this.rows.updateById(row.id, patch as never)
      : row;
    return this.toResource(builtin, updated);
  }

  /**
   * A custom prompt only: a built-in is part of Lore. Its past jobs stay.
   */
  public async remove(projectId: number, name: string): Promise<void> {
    const { builtin, row } = await this.find(projectId, name);
    if (builtin) {
      throw new BadRequestError(
        `'${name}' is a built-in prompt and cannot be deleted`,
      );
    }
    await this.rows.deleteById(row!.id);
  }

  /**
   * A custom prompt from any prompt, under a new name: the same text, args
   * with their accepted statuses, source and run time. It no longer follows
   * the built-in.
   */
  public async duplicate(
    projectId: number,
    user: UserAccountToken,
    name: string,
    body: { name: string; title?: string },
  ): Promise<PromptResource> {
    const from = await this.get(projectId, name);
    return this.create(projectId, user, {
      name: body.name,
      title: body.title ?? from.title,
      ...(from.description ? { description: from.description } : {}),
      text: from.text,
      args: from.args,
      source: from.source,
      ...(from.ref ? { ref: from.ref } : {}),
      timeoutSeconds: from.timeoutSeconds,
      concurrency: from.concurrency,
    });
  }

  /**
   * The prompt's text with its args filled, each value read with `user`'s
   * own permissions. A `member` arg left out is the caller.
   */
  public async render(
    projectId: number,
    user: UserAccountToken,
    name: string,
    args: Record<string, string>,
  ): Promise<{ text: string; prompt: PromptResource }> {
    const prompt = await this.get(projectId, name);
    const { values } = await this.resolveArgs(projectId, user, prompt, args);
    return { text: renderPromptText(prompt.text, values), prompt };
  }

  /**
   * Each arg of `prompt` read from `args` (a `member` left out is the
   * caller), with the values its placeholders take: what render and a run
   * share. A missing, unreadable or unaccepted item is a 400 naming its arg.
   */
  public async resolveArgs(
    projectId: number,
    user: UserAccountToken,
    prompt: Pick<PromptResource, "args">,
    args: Record<string, string>,
  ): Promise<{
    values: Record<string, string | number>;
    items: Array<{ arg: PromptArg; value: string; item: PromptArgItem }>;
  }> {
    const project = await this.projects.getOne({
      where: { id: { eq: projectId } },
    });
    const projectUrl = this.projectUrlOf(project);
    const values: Record<string, string | number> = {
      project: project.title,
      slug: project.slug ?? String(project.id),
      projectUrl,
    };
    const items: Array<{ arg: PromptArg; value: string; item: PromptArgItem }> =
      [];
    for (const arg of prompt.args) {
      const given = args[arg.name]?.trim();
      const value = given || (arg.type === "member" ? user.id : "");
      if (!value) {
        throw new BadRequestError(
          `The arg '${arg.name}' (${arg.type}) is missing`,
        );
      }
      // A choice is one of its options (#Q4415): no resolver, no permission.
      if (arg.type === "choice") {
        const options = arg.accepts ?? [];
        if (!options.includes(value)) {
          throw new BadRequestError(
            `The arg '${arg.name}' is one of ${options.join(", ")}, not '${value}'`,
          );
        }
        values[`${arg.name}.value`] = value;
        items.push({ arg, value, item: { fields: { value } } });
        continue;
      }
      const resolver = this.registry.arg(arg.type);
      if (!resolver) {
        throw new BadRequestError(
          `The arg '${arg.name}' takes a ${arg.type}, which this project cannot give`,
        );
      }
      if (
        !(await this.security.holds(projectId, user.id, resolver.permission))
      ) {
        throw new BadRequestError(
          `The arg '${arg.name}' needs ${resolver.permission} to read a ${arg.type}`,
        );
      }
      const item = await resolver.resolve({ project, projectUrl, value });
      if (!item) {
        throw new BadRequestError(
          `The arg '${arg.name}': no ${arg.type} ${value} in this project`,
        );
      }
      if (
        item.gone ||
        (arg.accepts?.length && !arg.accepts.includes(item.status ?? ""))
      ) {
        throw new BadRequestError(
          `The arg '${arg.name}' accepts a ${arg.type} ${
            arg.accepts?.length ? arg.accepts.join(" or ") : "that is not gone"
          }, and ${value} is ${item.status ?? "gone"}`,
        );
      }
      for (const [field, fieldValue] of Object.entries(item.fields)) {
        values[`${arg.name}.${field}`] = fieldValue;
      }
      items.push({ arg, value, item });
    }
    return { values, items };
  }

  /**
   * The project's pages, `<PUBLIC_URL>/<slug>`.
   */
  public projectUrlOf(project: Pick<Project, "id" | "slug">): string {
    return this.registry.projectUrlOf(project);
  }

  /**
   * The built-ins this project can use: their capability and option on.
   */
  public async usable(projectId: number): Promise<BuiltinPrompt[]> {
    const set = await this.security.capabilitiesOf(projectId);
    return this.registry.all().filter((it) => this.meets(set, it.needs));
  }

  /**
   * The pages this project can pin a prompt to (#Q4412): a page of an
   * option it has off, Requirements' views without `requirements`, is left
   * out.
   */
  public async pages(projectId: number): Promise<PromptPage[]> {
    const set = await this.security.capabilitiesOf(projectId);
    return this.registry.pages().filter((it) => this.meets(set, it.needs));
  }

  protected meets(
    set: Awaited<ReturnType<ProjectSecurityService["capabilitiesOf"]>>,
    needs: BuiltinPrompt["needs"],
  ): boolean {
    if (!needs) return true;
    return needs.option
      ? this.security.capabilityOption(set, needs.capability, needs.option)
      : this.security.hasCapability(set, needs.capability);
  }

  /**
   * A prompt by name: a usable built-in with its row if any, or a custom
   * row.
   */
  protected async find(
    projectId: number,
    name: string,
  ): Promise<{ builtin?: BuiltinPrompt; row?: Prompt }> {
    const registered = this.registry.get(name);
    if (registered) {
      const usable = (await this.usable(projectId)).some(
        (it) => it.name === name,
      );
      if (!usable) {
        throw new NotFoundError(
          `The built-in prompt '${name}' needs a capability this project has off`,
        );
      }
      return { builtin: registered, row: await this.rowOf(projectId, name) };
    }
    const row = await this.rowOf(projectId, name);
    if (!row || row.builtin) {
      throw new NotFoundError(`No prompt '${name}' in this project`);
    }
    return { row };
  }

  protected async rowOf(
    projectId: number,
    name: string,
  ): Promise<Prompt | undefined> {
    return this.rows.findOne({
      where: { projectId: { eq: projectId }, name: { eq: name } },
    });
  }

  /**
   * Arg names unique, and each accepted list made of its type's statuses,
   * or, for a choice, its options.
   */
  protected assertArgs(args: PromptArg[]): void {
    const seen = new Set<string>();
    for (const arg of args) {
      if (seen.has(arg.name)) {
        throw new BadRequestError(`Two args are named '${arg.name}'`);
      }
      seen.add(arg.name);
      if (arg.type === "choice") {
        this.assertChoice(arg);
        continue;
      }
      const statuses = PROMPT_ARG_STATUSES[arg.type];
      for (const status of arg.accepts ?? []) {
        if (!statuses.includes(status)) {
          throw new BadRequestError(
            statuses.length
              ? `The arg '${arg.name}' (${arg.type}) accepts statuses among ${statuses.join(", ")}, not '${status}'`
              : `The arg '${arg.name}' (${arg.type}) takes no list of statuses`,
          );
        }
      }
    }
  }

  /**
   * A choice's list is its options (#Q4415): at least two, each a slug,
   * each once.
   */
  protected assertChoice(arg: PromptArg): void {
    const options = arg.accepts ?? [];
    if (options.length < 2) {
      throw new BadRequestError(
        `The arg '${arg.name}' (choice) lists at least two options, as ${arg.name}:choice:a|b`,
      );
    }
    for (const option of options) {
      if (!PROMPT_CHOICE_OPTION.test(option)) {
        throw new BadRequestError(
          `The arg '${arg.name}' (choice): the option '${option}' is not a slug (a-z, 0-9 and -)`,
        );
      }
    }
    if (new Set(options).size !== options.length) {
      throw new BadRequestError(
        `The arg '${arg.name}' (choice) lists an option twice`,
      );
    }
  }

  /**
   * A placeholder naming an arg reads one this prompt declares, and a field
   * of its type.
   */
  protected assertPlaceholders(text: string, args: PromptArg[]): void {
    const byName = new Map(args.map((arg) => [arg.name, arg]));
    for (const placeholder of promptPlaceholders(text)) {
      const [name, field] = placeholder.split(".");
      // A bare one is the project's, or unknown and left verbatim.
      if (!field) continue;
      const arg = byName.get(name!);
      if (!arg) {
        throw new BadRequestError(
          `The text reads {{${placeholder}}}, but the prompt declares no arg '${name}'`,
        );
      }
      if (!PROMPT_ARG_FIELDS[arg.type].includes(field)) {
        throw new BadRequestError(
          `{{${placeholder}}}: a ${arg.type} has ${PROMPT_ARG_FIELDS[arg.type].join(", ")}, not '${field}'`,
        );
      }
    }
  }

  /**
   * The pins as given, each once, each a page of this project (#Q4284).
   */
  protected async pinsOf(projectId: number, pins: string[]): Promise<string[]> {
    // The project's pages (#Q4412): Requirements' views only with that
    // option on.
    const known = new Set((await this.pages(projectId)).map((it) => it.key));
    const unknown = pins.filter((it) => !known.has(it));
    if (unknown.length) {
      throw new BadRequestError(
        `No page '${unknown.join("', '")}' to pin a prompt to: ${[...known].join(", ")}`,
      );
    }
    return [...new Set(pins)];
  }

  /**
   * A host or agent the project does not have is refused, as a run would.
   */
  protected async assertWhere(
    projectId: number,
    body: { host?: string | null; agent?: string | null },
  ): Promise<void> {
    if (body.host || body.agent) {
      await this.agents.resolve(projectId, {
        ...(body.host ? { host: body.host } : {}),
        ...(body.agent ? { agent: body.agent } : {}),
      });
    }
  }

  /**
   * `ref`, `host`, `agent` and `model` as given: `null` clears one.
   */
  protected wherePatch(body: PromptWrite): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const key of ["ref", "host", "agent", "model"] as const) {
      if (body[key] !== undefined) patch[key] = body[key] ?? null;
    }
    return patch;
  }

  public toResource(
    builtin: BuiltinPrompt | undefined,
    row: Prompt | undefined,
  ): PromptResource {
    return {
      name: builtin?.name ?? row!.name,
      builtin: !!builtin,
      title: builtin?.title ?? row?.title ?? row!.name,
      description: builtin?.description ?? row?.description ?? "",
      args: builtin?.args ?? row?.args ?? [],
      text: builtin?.text ?? row?.text ?? "",
      source: row?.source ?? builtin?.source ?? "read",
      ...(row?.ref ? { ref: row.ref } : {}),
      ...(row?.host ? { host: row.host } : {}),
      ...(row?.agent ? { agent: row.agent } : {}),
      ...(row?.model ? { model: row.model } : {}),
      enabled: row?.enabled ?? true,
      permission: builtin?.permission ?? "host:update",
      timeoutSeconds:
        row?.timeoutSeconds ??
        builtin?.timeoutSeconds ??
        PROMPT_CUSTOM_TIMEOUT_SECONDS,
      ...(row?.createdBy ? { createdBy: row.createdBy } : {}),
      ...(row?.updatedAt ? { updatedAt: row.updatedAt } : {}),
      on: row ? this.alepha.inject(PromptTriggers).onOf(row) : "manual",
      ...(row?.check?.length ? { check: row.check } : {}),
      ...(row?.argValues ? { argValues: row.argValues } : {}),
      maxRunsPerHour: row?.maxRunsPerHour ?? 6,
      maxRunsPerDay: row?.maxRunsPerDay ?? 48,
      // A built-in's is Lore's (absent, unique); a custom prompt's queues
      // unless it says otherwise (#Q4354).
      concurrency: builtin
        ? (builtin.concurrency ?? "unique")
        : (row?.concurrency ?? "queue"),
      ...(row?.nextRunAt ? { nextRunAt: row.nextRunAt } : {}),
      ...(row?.lastRunAt ? { lastRunAt: row.lastRunAt } : {}),
      ...(row?.lastJobId ? { lastJobId: row.lastJobId } : {}),
      ...(row?.lastSkippedAt ? { lastSkippedAt: row.lastSkippedAt } : {}),
      ...(row?.lastSkippedReason
        ? { lastSkippedReason: row.lastSkippedReason }
        : {}),
      consecutiveFailures: row?.consecutiveFailures ?? 0,
      // A row that never set its pins takes the built-in's (#Q4339); a
      // stored `[]` is a project's unpin, kept.
      pins: row?.pins ?? builtin?.pins ?? [],
    };
  }
}
