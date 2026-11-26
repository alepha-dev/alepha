import {
  AgentJobs,
  type PromptArgContext,
  type PromptArgItem,
  PromptRegistry,
  type PromptRunContext,
  type PromptRunPlan,
  ProjectSecurityService,
} from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { ForbiddenError } from "alepha/server";

import { type ProjectError, projectErrors } from "../entities/projectErrors.ts";
import { investigateErrorPromptText } from "../prompts/investigateErrorPrompt.ts";
import { QUEST_STATUS_PREFIX } from "../schemas/projectErrorQuestStatus.ts";
import { ProjectErrorKinds } from "./ProjectErrorKinds.ts";

/**
 * What Ship gives the prompts about one error (#Q4471): the `error` arg, its
 * select, the error view as a pinnable page, and the built-in
 * `investigate-error` pinned to it.
 *
 * ⚠️ **No agent on an untrusted error.** The arg's `resolve` throws on one,
 * which refuses a render and a run whatever the client sent; `prepare`
 * checks again at the run, and `triggerRefusal` keeps an event from filling
 * the arg with one. The page's button says the same, but is not the gate.
 *
 * ⚠️ An error's name and message never reach a prompt's text or a job's
 * record through the arg: its `title` is its kind ("Server error"). That
 * text is written by whoever reaches the application.
 */
export class ShipErrorPrompts {
  /**
   * The newest errors an arg's select lists.
   */
  protected readonly OPTION_LIMIT = 200;

  protected readonly registry = $inject(PromptRegistry);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly kinds = $inject(ProjectErrorKinds);
  protected readonly errors = $repository(projectErrors);

  constructor() {
    this.registry.registerArg({
      type: "error",
      permission: "error:read",
      resolve: (context) => this.errorOf(context),
      triggerRefusal: async (projectId, value) => {
        const error = await this.find(projectId, value);
        return error && !error.trustedAt ? this.untrusted(error.id) : undefined;
      },
    });
    this.registry.registerOptions("error", (projectId, accepts) =>
      this.options(projectId, accepts),
    );
    this.registry.registerPage({
      key: "error",
      label: "Error view",
      gives: "error",
    });
    this.registry.register({
      name: "investigate-error",
      title: "Investigate error",
      description:
        "Read one error against the code, answer on its thread, and forward it to a quest carrying the finding when a fix is needed.",
      args: [{ name: "error", type: "error" }],
      source: "read",
      // What commenting needs. Forwarding needs `error:triage`, held or not
      // by the member who starts the run: the job key carries their rank.
      permission: "error:read",
      pins: ["error"],
      needs: { capability: "ship" },
      text: investigateErrorPromptText,
      prepare: (context) => this.prepare(context),
      oneShot: true,
    });
  }

  /**
   * The status an arg's accepted list is checked against: `forwarded`
   * stands for `quest:<id>`.
   */
  public statusOf(error: Pick<ProjectError, "status">): string {
    return error.status.startsWith(QUEST_STATUS_PREFIX)
      ? "forwarded"
      : error.status;
  }

  protected untrusted(errorId: number): string {
    return `Error ${errorId} is not trusted: a member reads its text before an agent does`;
  }

  /**
   * An error by the value an arg was given: `42`, `B42` or `#42`.
   */
  protected async find(
    projectId: number,
    value: string,
  ): Promise<ProjectError | undefined> {
    const match = /^#?[A-Za-z]?(\d{1,9})$/.exec(value.trim());
    if (!match) return undefined;
    return this.errors.findOne({
      where: { id: { eq: Number(match[1]) }, projectId: { eq: projectId } },
    });
  }

  protected async errorOf(
    context: PromptArgContext,
  ): Promise<PromptArgItem | undefined> {
    const error = await this.find(context.project.id, context.value);
    if (!error) return undefined;
    if (!error.trustedAt) throw new ForbiddenError(this.untrusted(error.id));
    return {
      status: this.statusOf(error),
      fields: {
        reference: `Error ${error.id}`,
        title: this.kinds.title(error),
        url: `${context.projectUrl}/errors/${error.id}`,
        number: error.id,
        id: error.id,
      },
    };
  }

  /**
   * The trusted errors an arg may take, the last seen first. An option's
   * label is read by a member in a select, as the inbox is: the error's
   * name is plain text there, and goes nowhere else.
   */
  protected async options(projectId: number, accepts?: string[]) {
    const rows = await this.errors.findMany({
      where: {
        projectId: { eq: projectId },
        trustedAt: { isNotNull: true },
      },
      orderBy: [{ column: "lastSeenAt", direction: "desc" }],
      limit: this.OPTION_LIMIT,
    });
    return rows
      .filter((it) => !accepts?.length || accepts.includes(this.statusOf(it)))
      .map((it) => ({
        value: String(it.id),
        label: `Error ${it.id} ${it.name}`.slice(0, 120),
      }));
  }

  /**
   * One run's own rules: the key pinned to the error, the job filed under
   * it so its thread shows the run, and whether the run may forward, which
   * the member who started it decides by their rank and the project by
   * having Plan. Said up front, so a run that may not forward files no
   * quest it could not link.
   */
  protected async prepare(context: PromptRunContext): Promise<PromptRunPlan> {
    const given = context.items.find((it) => it.arg.type === "error");
    const errorId = Number(given?.item.fields.id);
    const error = await this.errors.findOne({
      where: { id: { eq: errorId }, projectId: { eq: context.projectId } },
    });
    if (!error?.trustedAt) throw new ForbiddenError(this.untrusted(errorId));
    const [triages, capabilities] = await Promise.all([
      this.security.holds(context.projectId, context.startedBy, "error:triage"),
      this.security.capabilitiesOf(context.projectId),
    ]);
    const plans = this.security.hasCapability(capabilities, "plan");
    const forwarded = error.status.startsWith(QUEST_STATUS_PREFIX);
    const forward = forwarded
      ? "- The error is already forwarded to a quest: skip step 3, and name that quest in your comment."
      : !plans
        ? "- This project does not plan its work in Lore: skip step 3. Your comment is the whole answer."
        : !triages
          ? "- The member who started this run may not triage errors: skip step 3. Create no quest and forward nothing; end your comment by saying that a member who may triage errors can forward this one to a quest with your finding."
          : "- The member who started this run may triage errors: step 3 applies when a fix is needed.";
    return {
      prompt: [
        AgentJobs.PREAMBLE_MARKER,
        "",
        "## This run's rules, which override the procedure below where they differ",
        "",
        `- Your Lore key reaches error ${error.id} only: \`error_get\`, \`error_comment_add\`, \`error_resolve\` and \`error_forward\` are refused on any other.`,
        "- Nobody reads this run's conversation. Your comment on the error's thread is the report.",
        forward,
        "",
        context.text,
      ].join("\n"),
      errorId: error.id,
      subjectType: "error",
      subjectId: String(error.id),
    };
  }
}
