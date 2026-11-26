import {
  HostJobController,
  ProjectController,
  ProjectDashboardController,
  SearchController,
} from "@lore/core/api";
import { DashboardTools, JobTools, ProjectTools } from "@lore/core/mcp";
import {
  EpicController,
  FeedbackController,
  QuestCommentController,
  QuestController,
  ReleaseController,
} from "@lore/plan/api";
import {
  EpicTools,
  FeedbackTools,
  QuestTools,
  ReleaseTools,
} from "@lore/plan/mcp";
import { PromptController } from "@lore/prompts/api";
import { PromptTools } from "@lore/prompts/mcp";
import { FolioController } from "@lore/remember/api";
import { FolioTools } from "@lore/remember/mcp";
import {
  DeployController,
  MonitorController,
  ProjectErrorController,
  StackController,
} from "@lore/ship/api";
import {
  DeployTools,
  MonitorTools,
  ProjectErrorTools,
  StackTools,
} from "@lore/ship/mcp";
import { $inject, Alepha } from "alepha";
import type { ToolPrimitive } from "alepha/mcp";
import type { ActionPrimitive } from "alepha/server";

import { LoreAiDocsController } from "./LoreAiDocsController.ts";

/**
 * The assistant's tools and the permission each needs (#Q3208, #Q3209).
 *
 * The tools are Lore's own MCP tools, offered as they are (#E117): no
 * wrapper, no change to a name or a schema. Search is `SearchController`'s
 * `$action`, which `$ai` takes directly.
 *
 * ⚠️ A Lore `$tool` gates nothing itself: its handler calls a controller
 * action whose `$ownsProject({ requires })` is the gate. So what a tool needs
 * cannot be read off the tool, and this table says it, beside the list, with
 * the action that holds the gate. `assistant-tools.spec.ts` reads each gate's
 * own `requires` and refuses a table that disagrees.
 *
 * The table decides what the model is OFFERED, never what may run: a call
 * runs the tool as the turn's user, and the action's gate decides.
 *
 * Declaration order is what the vendor sees, and it stays stable so the
 * vendor caches it. Twenty-five read tools and seventeen writes: the eight
 * operations reads (#Q4235) went past the ~25 a small model handles, on
 * purpose, since an agent asked to watch the house had nothing to watch it
 * with, and #Q4297 added eight writes, deletes among them, each behind its
 * card. Every other MCP tool is listed in {@link LoreAiToolset.EXCLUDED}
 * with the reason it is not offered, and `assistant-mcp-parity.spec.ts`
 * fails on a tool that is in neither.
 */
export class LoreAiToolset {
  protected readonly alepha = $inject(Alepha);

  /*
   * Why an MCP tool is not offered to a chat agent (#Q4297). The goal is
   * parity with the MCP, so each exclusion states its reason, for the owner
   * to revise.
   */
  public static readonly HOST =
    "Deploys, undeploys or reaches into a host: stays on its page.";
  public static readonly SECRET =
    "Mints, rotates or deletes a credential, or lists them: never through a chat.";
  public static readonly TOO_BIG =
    "Its result is past the 32 KB `$ai` keeps of a tool result: project_info and getEpicRefs are offered in its place, until a paged variant exists.";
  public static readonly CROSS =
    "Spans projects, and a run is pinned to its room's project.";
  public static readonly AGENTS =
    "Changes how agents, prompts and notifications run: kept off the agents themselves, on the settings pages.";
  public static readonly ROOM =
    "The agent answers in its room and reads that room already: another room is out of its reach by design.";
  public static readonly FILES =
    "Moves a file: a chat turn has no file to hand a tool, and a file's bytes pass the 32 KB result cap.";
  public static readonly REPORTER =
    "Writes to an outside reporter, and its gate checks no project rank: stays on the Feedback page.";
  public static readonly LATER =
    "Not offered yet: waits for the tool search, which loads a rare tool's schema on demand rather than on every turn.";

  /**
   * Every MCP tool a chat agent is not offered, with the reason.
   * `assistant-mcp-parity.spec.ts` fails on a tool that is neither offered
   * nor listed here, so a new `$tool` is a decision, never a silent gap.
   */
  public static readonly EXCLUDED: Record<string, string> = {
    agent_hosts: LoreAiToolset.HOST,
    app_instance_create: LoreAiToolset.HOST,
    app_instance_delete: LoreAiToolset.HOST,
    app_instance_get: LoreAiToolset.LATER,
    app_instance_list: LoreAiToolset.LATER,
    app_instance_update: LoreAiToolset.HOST,
    area_delete: LoreAiToolset.LATER,
    artifact_get: LoreAiToolset.LATER,
    artifact_list: LoreAiToolset.LATER,
    channel_delete: LoreAiToolset.AGENTS,
    channel_update: LoreAiToolset.AGENTS,
    chat_agent_create: LoreAiToolset.AGENTS,
    chat_agent_delete: LoreAiToolset.AGENTS,
    chat_agent_get: LoreAiToolset.LATER,
    chat_agent_list: LoreAiToolset.LATER,
    chat_agent_update: LoreAiToolset.AGENTS,
    chat_message_list: LoreAiToolset.ROOM,
    chat_message_send: LoreAiToolset.ROOM,
    chat_room_list: LoreAiToolset.ROOM,
    criterion_verify_link: LoreAiToolset.LATER,
    dashboard_card_remove: LoreAiToolset.LATER,
    dashboard_card_reorder: LoreAiToolset.LATER,
    deploy_rollback: LoreAiToolset.HOST,
    deploy_start: LoreAiToolset.HOST,
    directory_create: LoreAiToolset.LATER,
    directory_delete: LoreAiToolset.LATER,
    directory_list: LoreAiToolset.LATER,
    directory_move: LoreAiToolset.LATER,
    directory_rename: LoreAiToolset.LATER,
    epic_delete: LoreAiToolset.LATER,
    epic_list: LoreAiToolset.TOO_BIG,
    epic_pull_request_add: LoreAiToolset.LATER,
    epic_review_answer: LoreAiToolset.LATER,
    epic_review_create: LoreAiToolset.LATER,
    epic_set_status: LoreAiToolset.LATER,
    epic_shelve: LoreAiToolset.LATER,
    epic_unshelve: LoreAiToolset.LATER,
    epic_update: LoreAiToolset.LATER,
    error_forward: LoreAiToolset.LATER,
    error_resolve: LoreAiToolset.LATER,
    event_catalog: LoreAiToolset.LATER,
    event_list: LoreAiToolset.LATER,
    feedback_attachment_get: LoreAiToolset.FILES,
    feedback_comment_add: LoreAiToolset.REPORTER,
    folio_attachment_add: LoreAiToolset.FILES,
    folio_attachment_delete: LoreAiToolset.LATER,
    folio_attachment_list: LoreAiToolset.LATER,
    folio_attachment_rename: LoreAiToolset.LATER,
    folio_column_set: LoreAiToolset.LATER,
    folio_history: LoreAiToolset.LATER,
    folio_list: LoreAiToolset.LATER,
    folio_revert: LoreAiToolset.LATER,
    folio_row_add: LoreAiToolset.LATER,
    folio_row_delete: LoreAiToolset.LATER,
    folio_row_list: LoreAiToolset.LATER,
    folio_row_update: LoreAiToolset.LATER,
    folio_update: LoreAiToolset.LATER,
    host_stats: LoreAiToolset.HOST,
    inbox_list: LoreAiToolset.LATER,
    inbox_read: LoreAiToolset.LATER,
    insights_read: LoreAiToolset.LATER,
    job_cancel: LoreAiToolset.HOST,
    job_poke: LoreAiToolset.HOST,
    monitor_create: LoreAiToolset.LATER,
    monitor_delete: LoreAiToolset.LATER,
    monitor_pause: LoreAiToolset.LATER,
    monitor_resume: LoreAiToolset.LATER,
    monitor_update: LoreAiToolset.LATER,
    persona_comment_add: LoreAiToolset.LATER,
    persona_create: LoreAiToolset.LATER,
    persona_delete: LoreAiToolset.LATER,
    persona_get: LoreAiToolset.LATER,
    persona_list: LoreAiToolset.LATER,
    persona_update: LoreAiToolset.LATER,
    project_activity: LoreAiToolset.LATER,
    project_context: LoreAiToolset.TOO_BIG,
    project_list: LoreAiToolset.CROSS,
    project_merge: LoreAiToolset.CROSS,
    project_report: LoreAiToolset.LATER,
    prompt_create: LoreAiToolset.AGENTS,
    prompt_delete: LoreAiToolset.AGENTS,
    prompt_duplicate: LoreAiToolset.AGENTS,
    prompt_get: LoreAiToolset.LATER,
    prompt_list: LoreAiToolset.LATER,
    prompt_pause_all: LoreAiToolset.AGENTS,
    prompt_render: LoreAiToolset.LATER,
    prompt_resume_all: LoreAiToolset.AGENTS,
    prompt_update: LoreAiToolset.AGENTS,
    quest_attachment_add: LoreAiToolset.FILES,
    quest_attachment_get: LoreAiToolset.FILES,
    quest_commit_add: LoreAiToolset.LATER,
    quest_hold: LoreAiToolset.LATER,
    quest_objective_set: LoreAiToolset.LATER,
    quest_pull_request_add: LoreAiToolset.LATER,
    quest_reminder_set: LoreAiToolset.LATER,
    quest_tags: LoreAiToolset.LATER,
    quest_unassign: LoreAiToolset.LATER,
    quest_unhold: LoreAiToolset.LATER,
    quest_unshelve: LoreAiToolset.LATER,
    release_attach: LoreAiToolset.LATER,
    release_changelog: LoreAiToolset.LATER,
    release_create: LoreAiToolset.LATER,
    release_delete: LoreAiToolset.LATER,
    release_detach: LoreAiToolset.LATER,
    release_set_default: LoreAiToolset.LATER,
    release_update: LoreAiToolset.LATER,
    requirement_coverage: LoreAiToolset.LATER,
    requirement_create: LoreAiToolset.LATER,
    requirement_delete: LoreAiToolset.LATER,
    requirement_get: LoreAiToolset.LATER,
    requirement_list: LoreAiToolset.LATER,
    requirement_set_release: LoreAiToolset.LATER,
    requirement_update: LoreAiToolset.LATER,
    sigil_create: LoreAiToolset.SECRET,
    sigil_delete: LoreAiToolset.SECRET,
    sigil_list: LoreAiToolset.SECRET,
    sigil_rotate: LoreAiToolset.SECRET,
    stack_deploy: LoreAiToolset.HOST,
    stack_logs: LoreAiToolset.HOST,
    stack_rollback: LoreAiToolset.HOST,
    subscription_list: LoreAiToolset.LATER,
    subscription_set: LoreAiToolset.AGENTS,
    threshold_get: LoreAiToolset.LATER,
    threshold_set: LoreAiToolset.AGENTS,
    usecase_comment_add: LoreAiToolset.LATER,
    usecase_create: LoreAiToolset.LATER,
    usecase_delete: LoreAiToolset.LATER,
    usecase_get: LoreAiToolset.LATER,
    usecase_link_epic: LoreAiToolset.LATER,
    usecase_list: LoreAiToolset.LATER,
    usecase_prompt: LoreAiToolset.LATER,
    usecase_run_attachment_add: LoreAiToolset.FILES,
    usecase_run_record: LoreAiToolset.LATER,
    usecase_update: LoreAiToolset.LATER,
    usecase_validate: LoreAiToolset.LATER,
  };

  /**
   * The three tables, built on first read and kept (#Q3398).
   *
   * No tool class and no controller is a field: a field would make each one
   * injected by this service, created at boot through the assistant, so none
   * could be a pure controller created on its first request. They are
   * resolved here, the first time the assistant or its access check asks.
   */
  protected built?: {
    inProject: LoreAiTool[];
    writes: LoreAiTool[];
  };

  /**
   * Offered inside a project, each when the user's effective permissions in
   * it hold every permission listed (and its capability is on).
   *
   * `$ai` cuts a tool result at 32 KB of text, mid-JSON, so every tool here
   * was measured on project 1, the largest real project (2026-11-09): each
   * stays under 10 KB in typical use. Hence `project_info`, not
   * `project_context` (which inlines pinned folios), and `getEpicRefs`, not
   * `epic_list`.
   */
  public get inProject(): LoreAiTool[] {
    return this.tables().inProject;
  }

  /**
   * The writes a member does most from the web (#Q3210), offered like the
   * reads and each paused on a confirmation card: none declares
   * `readOnlyHint: true`, which is what makes `$ai` wait for the user. Since
   * #Q4297 a delete or a shelve is offered too, behind its card, and since
   * #Q4512 a prompt's run; nothing that deploys or touches a host.
   *
   * `quest_update` is offered whole, every field of its schema: the card
   * shows each one the call sets. A comment needs `quest:update`, not
   * `quest:read`: that is what `createQuestComment`'s gate requires.
   */
  public get writes(): LoreAiTool[] {
    return this.tables().writes;
  }

  protected tables(): NonNullable<LoreAiToolset["built"]> {
    this.built ??= this.build();
    return this.built;
  }

  protected build(): NonNullable<LoreAiToolset["built"]> {
    const projectTools = this.alepha.inject(ProjectTools);
    const dashboardTools = this.alepha.inject(DashboardTools);
    const dashboardController = this.alepha.inject(ProjectDashboardController);
    const questTools = this.alepha.inject(QuestTools);
    const epicTools = this.alepha.inject(EpicTools);
    const folioTools = this.alepha.inject(FolioTools);
    const releaseTools = this.alepha.inject(ReleaseTools);
    const feedbackTools = this.alepha.inject(FeedbackTools);
    const searchController = this.alepha.inject(SearchController);
    const projectController = this.alepha.inject(ProjectController);
    const questController = this.alepha.inject(QuestController);
    const epicController = this.alepha.inject(EpicController);
    const folioController = this.alepha.inject(FolioController);
    const releaseController = this.alepha.inject(ReleaseController);
    const feedbackController = this.alepha.inject(FeedbackController);
    const commentController = this.alepha.inject(QuestCommentController);
    const docsController = this.alepha.inject(LoreAiDocsController);
    const promptTools = this.alepha.inject(PromptTools);
    const promptController = this.alepha.inject(PromptController);
    const monitorTools = this.alepha.inject(MonitorTools);
    const errorTools = this.alepha.inject(ProjectErrorTools);
    const jobTools = this.alepha.inject(JobTools);
    const deployTools = this.alepha.inject(DeployTools);
    const stackTools = this.alepha.inject(StackTools);
    const monitorController = this.alepha.inject(MonitorController);
    const errorController = this.alepha.inject(ProjectErrorController);
    const jobController = this.alepha.inject(HostJobController);
    const deployController = this.alepha.inject(DeployController);
    const stackController = this.alepha.inject(StackController);

    const inProject: LoreAiTool[] = [
      {
        tool: projectTools.project_info,
        permissions: ["project:read"],
        gate: projectController.getProjectById,
      },
      {
        tool: questTools.quest_list,
        permissions: ["quest:read"],
        gate: questController.getQuests,
      },
      {
        tool: questTools.quest_get,
        permissions: ["quest:read"],
        gate: questController.getQuestByShortId,
      },
      {
        // Not `epic_list`, which returns every epic with its description: 842 KB
        // on project 1 (2026-11-09, 118 epics), 26 times what `$ai` keeps of a
        // tool result, with no argument to narrow it. This index is the same
        // epics as id, number, title and status.
        tool: epicController.getEpicRefs,
        permissions: ["epic:read"],
        gate: epicController.getEpicRefs,
      },
      {
        tool: epicTools.epic_get,
        permissions: ["epic:read"],
        gate: epicController.getEpicDetailByNumber,
      },
      {
        tool: folioTools.folio_search,
        permissions: ["folio:read"],
        gate: folioController.list,
      },
      {
        tool: folioTools.folio_get,
        permissions: ["folio:read"],
        gate: folioController.getByShortId,
      },
      {
        tool: releaseTools.release_list,
        permissions: ["release:read"],
        gate: releaseController.getReleases,
      },
      {
        tool: releaseTools.release_get,
        permissions: ["release:read"],
        gate: releaseController.getReleaseContents,
      },
      {
        tool: feedbackTools.feedback_list,
        permissions: ["feedback:read"],
        gate: feedbackController.listFeedback,
      },
      {
        tool: feedbackTools.feedback_get,
        permissions: ["feedback:read"],
        gate: feedbackController.getFeedback,
      },
      {
        // The member's own projects that accept feedback (#Q3971): where
        // `feedback_submit` may file. Gated on sign-in only, no project.
        tool: feedbackTools.feedback_targets,
        permissions: [],
        gate: feedbackController.listFeedbackTargets,
      },
      {
        tool: searchController.search,
        permissions: ["quest:read", "folio:read"],
        gate: searchController.search,
      },
      {
        // Lore's own guides, for a how-to (#Q3212).
        tool: docsController.searchDocs,
        permissions: ["project:read"],
        gate: docsController.searchDocs,
      },
      {
        // The project's dashboards and their cards (#Q4213): what the board
        // shows is read with the tools of the module that owns the numbers.
        tool: dashboardTools.dashboard_list,
        permissions: ["project:read"],
        gate: dashboardController.listProjectDashboards,
      },
      {
        tool: dashboardTools.dashboard_metric_catalog,
        permissions: ["project:read"],
        gate: dashboardController.listProjectDashboardMetrics,
      },
      {
        tool: dashboardTools.dashboard_card_list,
        permissions: ["project:read"],
        gate: dashboardController.listProjectDashboardCards,
      },
      // How the project's apps run (#Q4235): reads only. Resolving an error,
      // deploying and rolling back stay on their pages.
      {
        tool: monitorTools.monitor_list,
        permissions: ["app:read"],
        gate: monitorController.listMonitors,
      },
      {
        tool: monitorTools.monitor_get,
        permissions: ["app:read"],
        gate: monitorController.getMonitorDetail,
      },
      {
        // Inside a run, the trusted groups only (#Q4233): a run is pinned to
        // its room's project, and `listProjectErrors` holds a pinned call to
        // the groups a member trusted, as it does a job key's.
        tool: errorTools.error_list,
        permissions: ["error:read"],
        gate: errorController.listProjectErrors,
      },
      {
        tool: jobTools.job_list,
        permissions: ["host:read"],
        gate: jobController.listProjectJobs,
      },
      {
        tool: jobTools.job_get,
        permissions: ["host:read"],
        gate: jobController.getJob,
      },
      {
        tool: deployTools.deploy_status,
        permissions: ["app:read"],
        gate: deployController.getDeployment,
      },
      {
        tool: stackTools.stack_list,
        permissions: ["app:read"],
        gate: stackController.listStacks,
      },
      {
        tool: stackTools.stack_get,
        permissions: ["app:read"],
        gate: stackController.listStackRevisions,
      },
    ];

    const writes: LoreAiTool[] = [
      {
        tool: questTools.quest_create,
        permissions: ["quest:create"],
        gate: questController.createQuest,
      },
      {
        tool: questTools.quest_comment_add,
        permissions: ["quest:update"],
        gate: commentController.createQuestComment,
      },
      {
        tool: questTools.quest_update,
        permissions: ["quest:update"],
        gate: questController.updateQuestById,
      },
      {
        tool: questTools.quest_complete,
        permissions: ["quest:update"],
        gate: questController.completeQuest,
      },
      {
        tool: folioTools.folio_create,
        permissions: ["folio:write"],
        gate: folioController.create,
      },
      // #Q4297: the actions a member asked the chat for and was sent back
      // to the page, each still paused on its card. The no-delete rule
      // became deletes behind a card, as the owner decided.
      {
        tool: questTools.quest_accept,
        permissions: ["quest:update"],
        gate: questController.acceptQuest,
      },
      {
        tool: questTools.quest_shelve,
        permissions: ["quest:update"],
        gate: questController.shelveQuest,
      },
      {
        tool: questTools.quest_delete,
        permissions: ["quest:delete"],
        gate: questController.deleteQuest,
      },
      {
        tool: epicTools.epic_create,
        permissions: ["epic:write"],
        gate: epicController.createEpic,
      },
      {
        tool: releaseTools.release_publish,
        permissions: ["release:manage"],
        gate: releaseController.publishRelease,
      },
      {
        tool: feedbackTools.feedback_accept,
        permissions: ["feedback:triage"],
        gate: feedbackController.acceptFeedback,
      },
      {
        tool: feedbackTools.feedback_reject,
        permissions: ["feedback:triage"],
        gate: feedbackController.rejectFeedback,
      },
      {
        tool: folioTools.folio_delete,
        permissions: ["folio:write"],
        gate: folioController.delete,
      },
      {
        // A card added or changed on a dashboard (#Q4213), shared by every
        // member: the card shows the call. Removing and reordering stay on
        // the board, like every delete.
        tool: dashboardTools.dashboard_card_add,
        permissions: ["project:update"],
        gate: dashboardController.addProjectDashboardCard,
      },
      {
        tool: dashboardTools.dashboard_card_update,
        permissions: ["project:update"],
        gate: dashboardController.updateProjectDashboardCard,
      },
      {
        // The one write that may leave the run's project (#Q3971): a
        // feedback into a project the member belongs to with Support on,
        // which the tool and the action check whatever the model passes.
        // Its gate holds no `$ownsProject`: feedback is open to outsiders,
        // so this room's rank says nothing about it.
        tool: feedbackTools.feedback_submit,
        permissions: [],
        gate: feedbackController.submitFeedback,
      },
      {
        // A run of one of the project's prompts (#Q4512), behind its card
        // like every write: the member who asked approves it, and the
        // action checks `host:read` and the prompt's own permission as
        // that member. Writing or pausing a prompt stays on its page.
        tool: promptTools.prompt_run,
        permissions: ["host:read"],
        gate: promptController.runPrompt,
      },
    ];

    return { inProject, writes };
  }

  /**
   * Every project-scoped tool, reads then writes.
   */
  public get projectScoped(): LoreAiTool[] {
    return [...this.inProject, ...this.writes];
  }

  /**
   * Every tool, in declaration order: what `$ai({ tools })` takes.
   */
  public get tools(): Array<ToolPrimitive<any> | ActionPrimitive<any>> {
    // Every run is in a project since the assistant answers in a chat room
    // (#Q3942): there is no off-project table any more.
    return this.projectScoped.map((entry) => entry.tool);
  }

  /**
   * A tool's name as the model sees it.
   */
  public nameOf(entry: LoreAiTool): string {
    return entry.tool.name;
  }
}

/**
 * One tool of the assistant, and what the user must hold in the project to
 * be offered it.
 */
export interface LoreAiTool {
  tool: ToolPrimitive<any> | ActionPrimitive<any>;
  /**
   * The permissions the tool's own gate requires, as `group:name`.
   */
  permissions: string[];
  /**
   * The controller action whose `$ownsProject` gates the tool, read by the
   * spec that holds `permissions` to it. Absent for a tool gated on sign-in
   * alone (`project_list`).
   */
  gate?: ActionPrimitive<any>;
}
