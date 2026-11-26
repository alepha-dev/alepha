import { $inject, Alepha, AlephaError } from "alepha";

import type { ProjectEvent } from "../entities/projectEvents.ts";
import type { Project } from "../entities/projects.ts";
import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import type { PromptArg } from "../schemas/promptArgSchema.ts";
import type { PromptJobCause } from "../schemas/promptJobCauseSchema.ts";
import type { PromptResource } from "../schemas/promptResourceSchema.ts";
import type {
  PromptArgType,
  PromptCheck,
  PromptConcurrency,
  PromptSource,
} from "../schemas/promptValues.ts";
import { PROMPT_NAME_PATTERN } from "../schemas/promptValues.ts";
import type { AgentJobRequest } from "./AgentJobs.ts";

/**
 * The built-in prompts and what fills their args (#E174, #Q4274), each
 * registered on the server by the module that owns it: Plan registers the
 * ten built-ins of the epic and the epic, quest and feedback args; core the
 * pull request and member args.
 *
 * A built-in's text is frozen: a project configures it (source, where it
 * runs, enabled) without copying it, and duplicates it to change its words.
 * Its name is reserved in every project.
 */
export class PromptRegistry {
  protected readonly alepha = $inject(Alepha);
  protected readonly prompts = new Map<string, BuiltinPrompt>();
  protected readonly resolvers = new Map<PromptArgType, PromptArgResolver>();
  protected readonly optionLists = new Map<PromptArgType, PromptArgOptions>();
  protected readonly pageMap = new Map<string, PromptPage>();
  protected readonly checks = new Map<
    PromptCheck,
    (projectId: number) => Promise<boolean>
  >();

  /**
   * The project's URL in Lore, what a prompt's `{{projectUrl}}` takes: part
   * of the contract (#E175), since Plan renders its own prompts with it.
   */
  public projectUrlOf(project: Pick<Project, "id" | "slug">): string {
    const base = String(this.alepha.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
    return `${base}/${project.slug ?? project.id}`;
  }

  public register(prompt: BuiltinPrompt): void {
    if (!PROMPT_NAME_PATTERN.test(prompt.name)) {
      throw new AlephaError(`Prompt name '${prompt.name}' is not a slug`);
    }
    if (this.prompts.has(prompt.name)) {
      throw new AlephaError(`Prompt '${prompt.name}' is registered twice`);
    }
    this.prompts.set(prompt.name, prompt);
  }

  public get(name: string): BuiltinPrompt | undefined {
    return this.prompts.get(name);
  }

  /**
   * The built-ins in registration order.
   */
  public all(): BuiltinPrompt[] {
    return [...this.prompts.values()];
  }

  public registerArg(resolver: PromptArgResolver): void {
    if (this.resolvers.has(resolver.type)) {
      throw new AlephaError(
        `Prompt arg type '${resolver.type}' is registered twice`,
      );
    }
    this.resolvers.set(resolver.type, resolver);
  }

  public arg(type: PromptArgType): PromptArgResolver | undefined {
    return this.resolvers.get(type);
  }

  /**
   * What an arg's select lists (#Q4280): the items of its type, among the
   * statuses it accepts. One per type, by the module that owns the items.
   */
  public registerOptions(type: PromptArgType, list: PromptArgOptions): void {
    if (this.optionLists.has(type)) {
      throw new AlephaError(
        `Prompt arg options '${type}' are registered twice`,
      );
    }
    this.optionLists.set(type, list);
  }

  public options(type: PromptArgType): PromptArgOptions | undefined {
    return this.optionLists.get(type);
  }

  /**
   * A page a prompt can be pinned to (#Q4284), registered by the module
   * that owns the page: Plan the quest, epic and feedback lists and views,
   * Ship the error list and an error's view. A pin naming no registered page is refused.
   */
  public registerPage(page: PromptPage): void {
    if (this.pageMap.has(page.key)) {
      throw new AlephaError(`Prompt page '${page.key}' is registered twice`);
    }
    this.pageMap.set(page.key, page);
  }

  /**
   * The pinnable pages in registration order.
   */
  public pages(): PromptPage[] {
    return [...this.pageMap.values()];
  }

  /**
   * A source a triggered run's `check` asks (#Q4277), one per module that
   * owns it: Plan's feedback, quests and epics, Ship's errors. A plain
   * query, asked before any job is queued.
   */
  public registerCheck(
    source: PromptCheck,
    has: (projectId: number) => Promise<boolean>,
  ): void {
    if (this.checks.has(source)) {
      throw new AlephaError(`Prompt check '${source}' is registered twice`);
    }
    this.checks.set(source, has);
  }

  public check(
    source: PromptCheck,
  ): ((projectId: number) => Promise<boolean>) | undefined {
    return this.checks.get(source);
  }
}

/**
 * A page a prompt can be pinned to (#Q4284): its key, its label, and the
 * type of the item it gives, which fills the prompt's arg of that type. A
 * list page gives nothing.
 */
export interface PromptPage {
  key: string;
  label: string;
  gives?: PromptArgType;
  /**
   * The capability and option a project needs for the page to exist, as a
   * built-in's `needs`: a page of an option that is off is not offered.
   */
  needs?: { capability: CapabilityKey; option?: string };
}

/**
 * A built-in prompt, as its module registers it.
 */
export interface BuiltinPrompt {
  /**
   * A slug, reserved in every project: `work-quest`.
   */
  name: string;
  title: string;
  description: string;
  args: PromptArg[];
  /**
   * Its own source; a project may change it on the prompt.
   */
  source: PromptSource;
  /**
   * What a run needs beyond `host:read`, held by its starter.
   */
  permission: string;
  /**
   * A run's time (#Q4439): absent, every agent job's 4 h
   * (`AGENT_JOB_TIMEOUT_SECONDS`). Only a prompt that works a whole set
   * names one, `AGENT_JOB_LONG_TIMEOUT_SECONDS`.
   */
  timeoutSeconds?: number;
  /**
   * What a second run of the same args does while one runs (#Q4354):
   * absent, `unique`. A built-in that reads a whole set each run (triage,
   * loose quests) says `queue`.
   */
  concurrency?: PromptConcurrency;
  /**
   * How long a triggered run whose event fills no item waits after a
   * burst's first event, so the burst lands in one run (#Q4501). Seconds,
   * absent 0: at once. A project may change it on the prompt.
   */
  settleSeconds?: number;
  /**
   * The pages it is pinned to until a project sets its own (#Q4339), by
   * page key: a view whose item fills its arg, or a list for a prompt that
   * takes none. A project that unpins it from every page keeps none.
   */
  pins?: string[];
  /**
   * The capability and option a project needs to use it: a built-in the
   * project cannot use is absent from its list and refused by render.
   */
  needs?: { capability: CapabilityKey; option?: string };
  /**
   * The words, with `{{project}}`, `{{slug}}`, `{{projectUrl}}` and
   * `{{<arg>.<field>}}` placeholders. English: its words name the tools it
   * calls.
   */
  text: string;
  /**
   * What only the server knows, added to a run of it (#Q4275): its key's
   * pin, its workspace, the items it is given, a refusal. Absent, the run
   * is the rendered text under Lore's preamble and nothing more.
   */
  prepare?: (context: PromptRunContext) => Promise<PromptRunPlan>;
  /**
   * Whether an event its trigger listens to is one for it (#Q4331), asked
   * before anything else, so an event it declines plans no run and records
   * no skip: `work-loose-quests` hears `quest.created` for a quest under no
   * epic and not tagged `needs-human` only. Absent, every event is.
   */
  acceptsEvent?: (event: ProjectEvent) => Promise<boolean>;
  /**
   * No built-in waits for an answer in its session: a question goes where a
   * person finds it, and the run ends.
   */
  oneShot: true;
}

/**
 * What a project and a caller resolve an arg's value against.
 */
export interface PromptArgContext {
  project: Project;
  /**
   * The address of the project's pages: `<PUBLIC_URL>/<slug>`.
   */
  projectUrl: string;
  /**
   * The value as given: a number, a reference (`#Q12`), a member's name or
   * id.
   */
  value: string;
}

/**
 * One arg type's reader: the permission a caller needs to read the item, and
 * the item itself, or nothing when it does not exist.
 */
export interface PromptArgResolver {
  type: PromptArgType;
  permission: string;
  resolve(context: PromptArgContext): Promise<PromptArgItem | undefined>;
  /**
   * Why an event may not fill this arg with this item, or nothing (#Q4277):
   * a quest tagged `needs-human` or born of outside text nobody confirmed,
   * an item no member trusted. A recorded skip, never a run.
   */
  triggerRefusal?(
    projectId: number,
    value: string,
  ): Promise<string | undefined>;
}

/**
 * An item an arg resolved to: its status, whether it is gone (a deleted or
 * shelved item is never accepted), and the fields its placeholders read.
 */
export interface PromptArgItem {
  status?: string;
  gone?: boolean;
  fields: Record<string, string | number>;
}

/**
 * What a built-in's `prepare` is given for one run (#Q4275).
 */
export interface PromptRunContext {
  projectId: number;
  startedBy: string;
  prompt: PromptResource;
  /**
   * The prompt's text with its args filled, without Lore's preamble.
   */
  text: string;
  items: Array<{ arg: PromptArg; value: string; item: PromptArgItem }>;
  /**
   * A run by hand's options: `fix` and `trust` for a pull request review.
   */
  options: { fix?: boolean; trust?: boolean };
  cause: PromptJobCause;
  /**
   * The source the prompt settled, before the built-in changes it.
   */
  source: NonNullable<AgentJobRequest["source"]>;
}

/**
 * What a built-in changes of a run's job, what it does once the job is
 * queued, and the items it left out.
 */
export type PromptRunPlan = Partial<
  Pick<
    AgentJobRequest,
    | "prompt"
    | "questNumber"
    | "feedbackNumber"
    | "feedbackNumbers"
    | "epicNumber"
    | "errorId"
    | "workspace"
    | "timeoutSeconds"
    | "source"
    | "untrusted"
    | "subjectType"
    | "subjectId"
  >
> & {
  after?: (jobId: string) => Promise<void>;
  skipped?: number[];
};

/**
 * An arg type's select: the project's items, newest first, among the
 * statuses an arg accepts (absent: every one but gone).
 */
export type PromptArgOptions = (
  projectId: number,
  accepts: string[] | undefined,
) => Promise<Array<{ value: string; label: string }>>;
