import {
  ResourceRegistry,
  $ownsProject,
  ProjectSecurityService,
} from "@lore/core/api";
import type { Project } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbEntityNotFoundError } from "alepha/orm";
import { OwnedResourceProvider, type UserAccountToken } from "alepha/security";
import {
  $action,
  BadRequestError,
  NotFoundError,
  okSchema,
} from "alepha/server";

import { DeployAnalytics } from "../entities/deployAnalytics.ts";
import type { ProjectErrorIgnoreRule } from "../entities/projectErrorIgnoreRules.ts";
import { type ProjectError, projectErrors } from "../entities/projectErrors.ts";
import { sigilErrorGroups } from "../entities/sigilErrorGroups.ts";
import { sigils } from "../entities/sigils.ts";
import {
  type ProjectErrorDetail,
  projectErrorDetailSchema,
} from "../schemas/projectErrorDetailSchema.ts";
import { QUEST_STATUS_PREFIX } from "../schemas/projectErrorQuestStatus.ts";
import {
  type ProjectErrorResource,
  projectErrorResourceSchema,
} from "../schemas/projectErrorResourceSchema.ts";
import {
  type ProjectErrorRuleResource,
  projectErrorRuleResourceSchema,
} from "../schemas/projectErrorRuleResourceSchema.ts";
import { projectErrorSigilSchema } from "../schemas/projectErrorSigilSchema.ts";
import {
  type ProjectErrorTrend,
  projectErrorTrendSchema,
} from "../schemas/projectErrorTrendSchema.ts";
import { ErrorSeriesWindow } from "../services/ErrorSeriesWindow.ts";
import { ErrorTrustEvents } from "../services/ErrorTrustEvents.ts";
import { ProjectErrorAccess } from "../services/ProjectErrorAccess.ts";
import { ProjectErrorKinds } from "../services/ProjectErrorKinds.ts";
import { ProjectErrorRuleService } from "../services/ProjectErrorRuleService.ts";
import { ProjectErrorThread } from "../services/ProjectErrorThread.ts";

/**
 * Owner-facing triage surface for errors — the deduplicated uncaught
 * exceptions captured by a project's sigils.
 *
 * Read endpoints (list + count) are member-gated via
 * `ProjectSecurityService.assertMember` so any project member can view the
 * inbox; mutations (resolve/forward/delete) stay owner-only via
 * `assertOwner`. An error carries its own `projectId`, so the scope is a
 * WHERE clause rather than a walk through the project's sigils — one less
 * step to get wrong, and it keeps working for an error whose sigil has since
 * been deleted.
 *
 * ⚠️ SECURITY: `name`, `message`, `stack`, `sourceUrl` on an error row are
 * 100% attacker-controlled. They are persisted verbatim and shown to the
 * project owner (the highest-value target). They must only ever be
 * rendered as escaped plain text — never markdown / `dangerouslySetInnerHTML`.
 * The forward-to-quest description embeds the stack as plain text too.
 * See folio #12.
 */
export class ProjectErrorController {
  /**
   * Area every error-forwarded quest is filed under — predictable triage.
   */
  protected readonly ERROR_AREA = "Errors";

  protected currentProjectErrors = $repository(projectErrors);
  protected sigils = $repository(sigils);
  protected security = $inject(ProjectSecurityService);
  protected resources = $inject(ResourceRegistry);
  protected ruleService = $inject(ProjectErrorRuleService);
  protected trustEvents = $inject(ErrorTrustEvents);
  protected access = $inject(ProjectErrorAccess);
  protected thread = $inject(ProjectErrorThread);
  protected users = $repository(users);
  protected dateTime = $inject(DateTimeProvider);
  protected errorGroups = $repository(sigilErrorGroups);
  protected kinds = $inject(ProjectErrorKinds);
  protected datasets = $inject(DeployAnalytics);
  protected window = $inject(ErrorSeriesWindow);

  /**
   * The window of one error's trend: what the `sigil_errors` dataset keeps
   * hot, hour by hour.
   */
  protected readonly TREND_DAYS = 30;
  protected owned = $inject(OwnedResourceProvider);

  /**
   * List errors for a project, newest-spread first (`count` desc).
   * Open-only by default; `includeResolved` also returns `resolved` and
   * `quest:*` rows. Owner-only.
   */
  listProjectErrors = $action({
    use: [$ownsProject({ requires: "error:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/errors",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        includeResolved: z.boolean().optional(),
      }),
      response: z.object({
        items: z.array(projectErrorResourceSchema),
        openCount: z.integer(),
        /**
         * Open groups no member trusted yet (#Q4233): no agent reads them,
         * so the inbox, and an agent's list, say how many wait.
         */
        awaitingTrust: z.integer(),
        sigils: z.array(projectErrorSigilSchema),
      }),
    },
    handler: async ({ params, query, user }) => {
      // An agent reads trusted groups only (#Q4233): their text comes from
      // an ingest open to anyone.
      const agent = await this.isAgent(user);
      const every = (
        await this.currentProjectErrors.findMany({
          where: { projectId: { eq: params.projectId } },
          // `id` makes the order total, so the page's previous and next
          // (`getProjectError`) walk the inbox in the order it shows.
          orderBy: [
            { column: "count", direction: "desc" },
            { column: "id", direction: "asc" },
          ],
        })
      ).sort((a, b) => b.count - a.count || a.id - b.id);
      const all = agent ? every.filter((b) => b.trustedAt) : every;

      // The inbox's filter options: which apps report here. Listed even when
      // they have filed nothing, so an owner can tell an app that is quiet from
      // one that was never enrolled.
      //
      // The wire field stays `label` — it is what the filter shows, and renaming
      // it would break every MCP client reading `error_list` — but its value is
      // now the sigil's `name`, the column `label` having been folded into it.
      const projectSigils = await this.sigils.findMany({
        where: { projectId: { eq: params.projectId } },
        orderBy: [{ column: "createdAt", direction: "desc" }],
      });
      const sigilOptions = projectSigils.map((sigil) => ({
        id: sigil.id,
        label: sigil.name,
      }));

      const openCount = all.filter((b) => b.status === "open").length;
      const items = query.includeResolved
        ? all
        : all.filter((b) => b.status === "open");
      const awaitingTrust = every.filter(
        (b) => b.status === "open" && !b.trustedAt,
      ).length;
      const trusters = await this.trusters(items);
      const linked = this.linkedErrors(all);

      return {
        items: items.map((b) => ({
          ...this.toResource(b, trusters),
          ...(linked.get(b.id) ? { linkedError: linked.get(b.id) } : {}),
        })),
        openCount,
        awaitingTrust,
        sigils: sigilOptions,
      };
    },
  });

  /**
   * Count of `open` errors for a project — feeds the sidebar badge.
   * Readable by any project member.
   */
  countOpenProjectErrors = $action({
    use: [$ownsProject({ requires: "error:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/errors/count",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ count: z.integer() }),
    },
    handler: async ({ params, user }) => {
      // One read of the live table, matching the inbox. The two-hop count
      // through sigils would now return zero for every project, because
      // nothing has written to that table since Lore stopped ingesting — the
      // badge would sit at 0 over a full inbox.
      const open = await this.currentProjectErrors.findMany({
        where: {
          projectId: { eq: params.projectId },
          status: { eq: "open" },
        },
        columns: ["id"],
      });

      return { count: open.length };
    },
  });

  /**
   * One error with everything Lore knows beside the row (#E185): its kind,
   * the apps that reported it, the error on the other side of its request,
   * the quest it was forwarded to, the ignore rules its message matches and
   * its neighbours in the open inbox.
   *
   * One trip after the row is read: every block is one statement, issued
   * together, never one per app or per rule.
   *
   * An agent is refused on an untrusted error, never handed a redacted row
   * ({@link assertAgentMayRead}); an error of another project is a 404.
   */
  getProjectError = $action({
    use: [$ownsProject({ requires: "error:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/errors/:errorId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        errorId: z.integer(),
      }),
      response: projectErrorDetailSchema,
    },
    handler: async ({ params, user }): Promise<ProjectErrorDetail> => {
      // Whether an agent reads does not wait on the row: one trip for both.
      const [row, agent] = await Promise.all([
        this.loadProjectError(params.projectId, params.errorId),
        this.isAgent(user),
      ]);
      if (agent && !row.trustedAt) {
        await this.assertAgentMayRead(row, user);
      }
      const kind = this.kinds.of(row);
      const monitorId = this.kinds.monitorId(row);
      const [apps, linkedError, quest, rules, neighbours, trusters, useCase] =
        await Promise.all([
          kind === "sigil" ? this.appsOf(row) : [],
          this.linkedErrorOf(row, agent),
          this.questOf(row, user),
          this.ruleService.listForProject(row.projectId),
          this.neighboursOf(row, agent),
          this.trusters([row]),
          this.useCaseOf(row, user),
        ]);
      return {
        error: {
          ...this.toResource(row, trusters),
          ...(linkedError ? { linkedError } : {}),
        },
        kind,
        apps,
        ...(quest ? { quest } : {}),
        ...(kind === "run"
          ? {
              run: {
                ...(row.useCaseRunId != null
                  ? { useCaseRunId: row.useCaseRunId }
                  : {}),
                ...(row.criterionKey ? { criterionKey: row.criterionKey } : {}),
                ...(useCase ? { useCase } : {}),
              },
            }
          : {}),
        ...(monitorId ? { monitor: { id: monitorId } } : {}),
        rules: rules
          .filter((rule) => this.ruleService.matches(row.message, [rule]))
          .map((rule) => this.toRuleResource(rule)),
        ...neighbours,
      };
    },
  });

  /**
   * One error's occurrences per day over the last 30 days, with the
   * project's deploys marked (#E185): did that deploy make it better or
   * worse. Its own action, so the page loads it beside the single read.
   *
   * The series is the `sigil_errors` dataset narrowed to this fingerprint,
   * across the project's apps, zero-filled here. A `run` or an `uptime`
   * error has no series, and neither has a project with no app: the answer
   * is an explicit empty.
   *
   * Same gates as {@link getProjectError}.
   */
  getProjectErrorTrend = $action({
    use: [$ownsProject({ requires: "error:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/errors/:errorId/trend",
    schema: {
      params: z.object({
        projectId: z.integer(),
        errorId: z.integer(),
      }),
      response: projectErrorTrendSchema,
    },
    handler: async ({ params, user }): Promise<ProjectErrorTrend> => {
      const row = await this.loadProjectError(params.projectId, params.errorId);
      await this.assertAgentMayRead(row, user);
      const nothing = { empty: true, series: [], markers: [], total: 0 };
      if (this.kinds.of(row) !== "sigil") return nothing;
      const apps = await this.sigils.findMany({
        where: { projectId: { eq: row.projectId } },
        columns: ["id"],
      });
      if (apps.length === 0) return nothing;
      const days = this.window.days(this.TREND_DAYS);
      const [errors, markers] = await Promise.all([
        this.datasets.errors.query({
          since: days[0]!,
          until: days[days.length - 1]!,
          // The fingerprint is a plain value: an `$analytics` where takes no
          // `{ eq }`.
          where: {
            sigilId: { inArray: apps.map((app) => app.id) },
            fingerprint: row.fingerprint,
          },
          groupBy: ["day"],
          select: { count: "sum" },
        }),
        this.window.deploys(row.projectId, days[0]!),
      ]);
      const byDay = new Map(
        errors.rows.map((it) => [String(it.day), Number(it.count)]),
      );
      const series = days.map((at) => ({ at, value: byDay.get(at) ?? 0 }));
      return {
        empty: false,
        series,
        markers,
        total: series.reduce((sum, point) => sum + point.value, 0),
      };
    },
  });

  /**
   * Resolve an error — `status = "resolved"`. The row stays for audit; the
   * default inbox view hides it. Owner-only.
   */
  resolveProjectError = $action({
    use: [
      $ownsProject({
        requires: "error:triage",
        param: "projectId",
        capability: { key: "ship", action: "resolve an error" },
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/errors/:errorId/resolve",
    schema: {
      params: z.object({
        projectId: z.integer(),
        errorId: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const projectError = await this.loadProjectError(
        params.projectId,
        params.errorId,
      );
      await this.assertAgentMayRead(projectError, user);
      // Resolving a resolved error changes nothing and keeps its date,
      // unless it was seen again since (#Q4466): the member answers that
      // report, so the date moves and the mark goes.
      const changes =
        projectError.status !== "resolved" || this.seenAgain(projectError);
      await this.currentProjectErrors.updateById(projectError.id, {
        status: "resolved",
        ...(changes ? { resolvedAt: this.dateTime.nowISOString() } : {}),
      });
      // After the change, never before it (#E185): see
      // `ProjectErrorThread.record`. A resolve that changed nothing leaves
      // no line.
      if (changes) {
        await this.thread.record(projectError.id, "resolved", {
          actorId: user.id,
        });
      }
      return { ok: true };
    },
  });

  /**
   * Trust an open error group (#Q4233): a member read its text and confirms
   * an agent may now read it too. Recorded once, with who and when, and kept
   * when the group is reported again.
   *
   * ⚠️ **A signed-in session only** (`sessionOnly`): an API key, a job key
   * and the MCP are refused with a 403, as for a feedback item's Trust
   * (#Q4216). The rule is that a human reads outside text before any agent
   * does; an agent that could trust a group would undo it. No MCP tool and
   * no CLI command calls this, by design.
   */
  trustProjectError = $action({
    use: [
      $ownsProject({
        requires: "error:triage",
        param: "projectId",
        capability: { key: "ship", action: "trust an error" },
        secure: { sessionOnly: true },
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/errors/:errorId/trust",
    schema: {
      params: z.object({
        projectId: z.integer(),
        errorId: z.integer(),
      }),
      response: z.object({
        trustedAt: z.string(),
        trustedBy: z.uuid().optional(),
      }),
    },
    handler: async ({ params, user }) => {
      const projectError = await this.loadProjectError(
        params.projectId,
        params.errorId,
      );
      if (projectError.status !== "open") {
        throw new BadRequestError(
          `Error ${projectError.id} is ${projectError.status}: only an open group is trusted`,
        );
      }
      if (projectError.trustedAt) {
        return {
          trustedAt: projectError.trustedAt,
          trustedBy: projectError.trustedBy ?? undefined,
        };
      }
      const trustedAt = this.dateTime.nowISOString();
      // With `error.trusted` (#Q4331): a triage trigger hears the group an
      // agent may read now.
      const trusted = await this.trustEvents.trust(
        projectError,
        user.id,
        trustedAt,
      );
      return {
        trustedAt: trusted.trustedAt ?? trustedAt,
        trustedBy: trusted.trustedBy ?? undefined,
      };
    },
  });

  /**
   * Withdraw an error group's trust (#Q4255): a member read its text and
   * found outside input an agent should not read, typically in a server
   * group trusted on arrival. The group is untrusted again, and stays so
   * when it is reported again. A member may trust it later.
   *
   * ⚠️ **A signed-in session only**, like {@link trustProjectError}: an
   * agent that could move the trust either way would decide what it reads.
   */
  untrustProjectError = $action({
    use: [
      $ownsProject({
        requires: "error:triage",
        param: "projectId",
        capability: { key: "ship", action: "untrust an error" },
        secure: { sessionOnly: true },
      }),
    ],
    method: "DELETE",
    path: "/projects/:projectId/errors/:errorId/trust",
    schema: {
      params: z.object({
        projectId: z.integer(),
        errorId: z.integer(),
      }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params, user }) => {
      const projectError = await this.loadProjectError(
        params.projectId,
        params.errorId,
      );
      if (projectError.trustedAt) {
        await this.currentProjectErrors.updateById(projectError.id, {
          trustedAt: null,
          trustedBy: null,
        });
        await this.thread.record(projectError.id, "untrusted", {
          actorId: user.id,
        });
      }
      return { ok: true };
    },
  });

  /**
   * Forward an error to a new quest. Creates a quest in the project with
   * the error's name/message as the title and the stack + spread summary
   * as the (plain-text) description, links the quest back via
   * `quests.source.projectErrorId`, and flips the error to
   * `status = "quest:<id>"`. Owner-only.
   */
  forwardProjectErrorToQuest = $action({
    use: [
      $ownsProject({
        requires: "error:triage",
        param: "projectId",
        capability: { key: "ship", action: "forward an error" },
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/errors/:errorId/forward",
    schema: {
      params: z.object({
        projectId: z.integer(),
        errorId: z.integer(),
      }),
      /**
       * An existing quest of this project to link instead of creating one
       * (#Q3802): an agent that filed the quest itself names it here.
       */
      body: z
        .object({
          questShortId: z
            .integer()
            .describe(
              "An existing quest of this project to link, by its per-project number, instead of creating one",
            )
            .optional(),
        })
        .optional(),
      response: z.object({ questId: z.integer(), questShortId: z.integer() }),
    },
    handler: async ({ params, body, user }) => {
      // ⚠️ The one cross-capability write in the app, and the rule it follows
      // is the epic's: a capability may read another's state to NARROW what it
      // does, never to widen it. Forwarding creates a quest, so it needs Work
      // as well as Apps; the button hides in the UI and the API refuses here.
      await this.security.assertCapability(params.projectId, "plan", {
        action: "forward an error into a quest",
      });
      const projectError = await this.loadProjectError(
        params.projectId,
        params.errorId,
      );
      await this.assertAgentMayRead(projectError, user);

      if (projectError.status.startsWith(QUEST_STATUS_PREFIX)) {
        throw new BadRequestError("Error already forwarded to a quest");
      }

      if (body?.questShortId !== undefined) {
        return this.linkToQuest(
          params.projectId,
          projectError,
          body.questShortId,
          user.id,
        );
      }

      // Title: `[ProjectError] TypeError: cannot read…` — name + message,
      // truncated. Plain text, never rendered as markdown.
      const summary = [projectError.name, projectError.message]
        .filter((s) => s.trim().length > 0)
        .join(": ");
      const title = `[Error] ${summary}`.slice(0, 200);

      // Description: attacker-controlled text, and the quest description is
      // rendered as markdown downstream (and read by MCP agents). Anonymous
      // ingest writes the stack and the source URL, so neither may become
      // markup (#Q2520): the stack is fenced with more backticks than its
      // longest run, so a stray ``` inside it cannot close the fence, and
      // the source URL is a code span, never a link or an image. The stack
      // is cut BEFORE fencing, so the length cap can never slice the closing
      // fence off.
      const stack = (projectError.stack || "(no stack captured)").slice(
        0,
        9_000,
      );
      const description = [
        `Forwarded from error #${projectError.id} (${projectError.fingerprint.slice(0, 12)}…).`,
        "",
        `Seen ${projectError.count} time(s), last on ${projectError.lastSeenAt}.`,
        "",
        projectError.sourceUrl
          ? `Source: ${this.codeSpan(projectError.sourceUrl.slice(0, 500))}`
          : "",
        "",
        "Stack:",
        this.codeFence(stack),
      ].join("\n");

      // Error-forwarded quests always land in a dedicated "Errors" area
      // (created on the project if absent) — predictable triage, not
      // whatever the project's arbitrary first area happens to be.
      // Creation mechanics (shortId, area-ensure, defaults) are Work's: this
      // module asks the registered `quest` kind, and never imports quest
      // code (#E75, #Q2610). Without Work registered, the forward is refused
      // by name.
      const questKind = this.resources.require(
        "quest",
        "forward an error into a quest",
      );
      const quest = await questKind.create!({
        projectId: params.projectId,
        title,
        description,
        area: this.ERROR_AREA,
        priority: "medium",
        tags: ["bug"],
        createdBy: user.id,
        source: { projectErrorId: projectError.id },
      });

      // The refusal above, again, inside the write (#Q2550): a double click
      // passes the read twice. No transaction (D1): the loser's quest is
      // hard-deleted instead of rolled back. Nothing points at it yet (this
      // path writes no link and no audit), its shortId stays a gap, and a
      // "Errors" area it may have created stays as a legal empty row.
      try {
        await this.currentProjectErrors.updateOne(
          {
            id: { eq: projectError.id },
            status: { notLike: `${QUEST_STATUS_PREFIX}%` },
          },
          { status: `${QUEST_STATUS_PREFIX}${quest.id}`, resolvedAt: null },
        );
      } catch (error) {
        if (!(error instanceof DbEntityNotFoundError)) throw error;
        await questKind.discard!(quest.id);
        throw new BadRequestError("Error already forwarded to a quest");
      }
      await this.thread.record(projectError.id, "forwarded", {
        actorId: user.id,
        questId: quest.id,
      });

      return { questId: quest.id, questShortId: quest.shortId };
    },
  });

  /**
   * Forward an error to a quest already filed (#Q3802): the `quest` kind
   * records the error as the quest's source (same project only, never over
   * another source), then the error points at the quest. A double click
   * that loses the race on the error takes the source back off.
   */
  protected async linkToQuest(
    projectId: number,
    projectError: ProjectError,
    questShortId: number,
    actorId: string,
  ): Promise<{ questId: number; questShortId: number }> {
    const questKind = this.resources.require(
      "quest",
      "forward an error into a quest",
    );
    const quest = await questKind.adopt!({
      projectId,
      shortId: questShortId,
      source: { projectErrorId: projectError.id },
    });
    try {
      await this.currentProjectErrors.updateOne(
        {
          id: { eq: projectError.id },
          status: { notLike: `${QUEST_STATUS_PREFIX}%` },
        },
        { status: `${QUEST_STATUS_PREFIX}${quest.id}`, resolvedAt: null },
      );
    } catch (error) {
      if (!(error instanceof DbEntityNotFoundError)) throw error;
      await questKind.disown!(quest.id);
      throw new BadRequestError("Error already forwarded to a quest");
    }
    await this.thread.record(projectError.id, "linked", {
      actorId,
      questId: quest.id,
    });
    return { questId: quest.id, questShortId: quest.shortId };
  }

  /**
   * Hard-delete an error row. Owner-only.
   */
  deleteProjectError = $action({
    use: [
      $ownsProject({
        requires: "error:triage",
        param: "projectId",
        capability: { key: "ship", action: "delete an error" },
      }),
    ],
    method: "DELETE",
    path: "/projects/:projectId/errors/:errorId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        errorId: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const projectError = await this.loadProjectError(
        params.projectId,
        params.errorId,
      );
      await this.currentProjectErrors.deleteById(projectError.id);
      // Its events cascade; its comments are core's rows, removed by hand.
      await this.thread.deleteFor([projectError.id]);
      return { ok: true };
    },
  });

  /**
   * Mass-delete errors by id. Each id is validated to belong to the project
   * (the `projectId` filter is the cross-project guard), so stray ids are
   * silently skipped rather than leaking or 404-ing the whole batch.
   * Owner-only. Returns how many rows were actually removed.
   */
  deleteProjectErrors = $action({
    use: [
      $ownsProject({
        requires: "error:triage",
        param: "projectId",
        capability: { key: "ship", action: "delete errors" },
      }),
    ],
    method: "DELETE",
    path: "/projects/:projectId/errors",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        ids: z.array(z.integer()).min(1).max(200),
      }),
      response: z.object({ deleted: z.integer() }),
    },
    handler: async ({ params, body, user }) => {
      // Scoped by `projectId`, not by the project's sigil ids: an error whose
      // sigil was deleted keeps `projectId` and loses `sigilId`, and the
      // sigil-list version silently refused to delete exactly those rows.
      const rows = await this.currentProjectErrors.findMany({
        where: {
          id: { inArray: body.ids },
          projectId: { eq: params.projectId },
        },
      });
      for (const row of rows) {
        await this.currentProjectErrors.deleteById(row.id);
      }
      await this.thread.deleteFor(rows.map((row) => row.id));
      return { deleted: rows.length };
    },
  });

  /**
   * List the project's error ignore rules — the message substrings that
   * drop matching crashes at ingestion. Readable by any project member (the
   * inbox surfaces them in the rules dialog); mutations stay owner-only.
   */
  listProjectErrorRules = $action({
    use: [$ownsProject({ requires: "error:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/errors/rules",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(projectErrorRuleResourceSchema) }),
    },
    handler: async ({ params, user }) => {
      const rules = await this.ruleService.listForProject(params.projectId);
      return { items: rules.map((r) => this.toRuleResource(r)) };
    },
  });

  /**
   * Add an error ignore rule. The `pattern` is a case-insensitive substring
   * matched against an incoming crash's `message`; matching events are dropped
   * at ingestion going forward (existing rows are untouched — use mass-delete
   * to clear them). Owner-only.
   */
  createProjectErrorRule = $action({
    use: [
      $ownsProject({
        requires: "error:triage",
        param: "projectId",
        capability: { key: "ship", action: "create an error rule" },
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/errors/rules",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        pattern: z.string().min(1).max(200),
      }),
      response: projectErrorRuleResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const pattern = body.pattern.trim();
      if (pattern.length === 0) {
        throw new BadRequestError("Pattern must not be empty");
      }
      const rule = await this.ruleService.create(
        params.projectId,
        pattern,
        user.id,
      );
      return this.toRuleResource(rule);
    },
  });

  /**
   * Delete an error ignore rule. Owner-only.
   */
  deleteProjectErrorRule = $action({
    use: [
      $ownsProject({
        requires: "error:triage",
        param: "projectId",
        capability: { key: "ship", action: "delete an error rule" },
      }),
    ],
    method: "DELETE",
    path: "/projects/:projectId/errors/rules/:ruleId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        ruleId: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const ok = await this.ruleService.deleteForProject(
        params.projectId,
        params.ruleId,
      );
      if (!ok) {
        throw new NotFoundError("Rule not found");
      }
      return { ok: true };
    },
  });

  /**
   * The error of this project, or a 404: `ProjectErrorAccess.load`.
   */
  protected loadProjectError(projectId: number, errorId: number) {
    return this.access.load(projectId, errorId);
  }

  /**
   * The apps that reported this fingerprint, busiest first: one statement
   * for the project's apps and one for their groups, whatever their number.
   * The groups are scoped by a subquery on the project's sigils, never by a
   * list of ids, which a project with many apps would push past D1's bound
   * parameters.
   */
  protected async appsOf(
    row: ProjectError,
  ): Promise<ProjectErrorDetail["apps"]> {
    const [names, groups] = await Promise.all([
      this.sigils.findMany({
        where: { projectId: { eq: row.projectId } },
        columns: ["id", "name"],
      }),
      this.errorGroups.findMany({
        where: {
          fingerprint: { eq: row.fingerprint },
          sigilId: {
            inArray: this.sigils.subquery(
              { projectId: { eq: row.projectId } },
              "id",
            ),
          },
        },
        columns: ["sigilId", "count", "firstSeenAt", "lastSeenAt"],
        orderBy: [
          { column: "count", direction: "desc" },
          { column: "id", direction: "asc" },
        ],
      }),
    ]);
    const labels = new Map(names.map((sigil) => [sigil.id, sigil.name]));
    return groups.map((group) => ({
      sigilId: group.sigilId,
      label: labels.get(group.sigilId) ?? "",
      count: group.count,
      firstSeenAt: group.firstSeenAt,
      lastSeenAt: group.lastSeenAt,
    }));
  }

  /**
   * The error on the other side of the same request (#Q4404), as the list
   * pairs them: read over the groups naming this request, which is a few
   * rows. An agent is never pointed at a group it may not read.
   */
  protected async linkedErrorOf(
    row: ProjectError,
    agent: boolean,
  ): Promise<{ id: number; origin: ProjectError["origin"] } | undefined> {
    if (!row.requestId) return undefined;
    const sharing = await this.currentProjectErrors.findMany({
      where: {
        projectId: { eq: row.projectId },
        requestId: { eq: row.requestId },
      },
      limit: 20,
    });
    const visible = agent ? sharing.filter((it) => it.trustedAt) : sharing;
    return this.linkedErrors(visible).get(row.id);
  }

  /**
   * The quest a forwarded error points at, through the `quest` kind of the
   * resources registry: Ship never reads a quest (#E75). Absent while Plan
   * is off or not registered, for a caller who may not read quests, and
   * once the quest is gone.
   */
  protected async questOf(
    row: ProjectError,
    user: UserAccountToken,
  ): Promise<ProjectErrorDetail["quest"]> {
    if (!row.status.startsWith(QUEST_STATUS_PREFIX)) return undefined;
    if (
      !(await this.access.questsReadable(this.owned.authority<Project>(), user))
    ) {
      return undefined;
    }
    const id = row.status.slice(QUEST_STATUS_PREFIX.length);
    const [ref] = await this.resources.describe("quest", row.projectId, [id]);
    if (!ref) return undefined;
    return {
      id: Number(ref.id),
      shortId: ref.shortId,
      title: ref.title,
      ...(ref.status ? { status: ref.status } : {}),
    };
  }

  /**
   * The use case a run error verified, through the `usecase` kind of the
   * resources registry, for the page's link to it. Absent for any other
   * error, where no module registers the kind, and for a caller who may not
   * read use cases.
   */
  protected async useCaseOf(
    row: ProjectError,
    user: UserAccountToken,
  ): Promise<{ number: number; title: string } | undefined> {
    const id = this.kinds.useCaseId(row);
    if (id === undefined) return undefined;
    if (
      !(await this.access.kindReadable(
        "usecase",
        this.owned.authority<Project>(),
        user,
      ))
    ) {
      return undefined;
    }
    const [ref] = await this.resources.describe("usecase", row.projectId, [
      String(id),
    ]);
    return ref ? { number: ref.shortId, title: ref.title } : undefined;
  }

  /**
   * The errors before and after this one in the open inbox, in the list's
   * order made total: `count` descending, then `id`. One row each, read by
   * the order itself rather than by listing the inbox. Nothing for an error
   * that is not open; an agent walks the trusted ones only.
   */
  protected async neighboursOf(
    row: ProjectError,
    agent: boolean,
  ): Promise<{ previousId?: number; nextId?: number }> {
    if (row.status !== "open") return {};
    const scope = {
      projectId: { eq: row.projectId },
      status: { eq: "open" },
      ...(agent ? { trustedAt: { isNotNull: true } } : {}),
    };
    const [previous, next] = await Promise.all([
      this.currentProjectErrors.findMany({
        where: {
          ...scope,
          or: [
            { count: { gt: row.count } },
            { count: { eq: row.count }, id: { lt: row.id } },
          ],
        },
        columns: ["id"],
        orderBy: [
          { column: "count", direction: "asc" },
          { column: "id", direction: "desc" },
        ],
        limit: 1,
      }),
      this.currentProjectErrors.findMany({
        where: {
          ...scope,
          or: [
            { count: { lt: row.count } },
            { count: { eq: row.count }, id: { gt: row.id } },
          ],
        },
        columns: ["id"],
        orderBy: [
          { column: "count", direction: "desc" },
          { column: "id", direction: "asc" },
        ],
        limit: 1,
      }),
    ]);
    return {
      ...(previous[0] ? { previousId: previous[0].id } : {}),
      ...(next[0] ? { nextId: next[0].id } : {}),
    };
  }

  /**
   * Whether a model is reading: `ProjectErrorAccess.isAgent`.
   */
  protected isAgent(user: UserAccountToken | undefined): Promise<boolean> {
    return this.access.isAgent(user);
  }

  /**
   * An agent acts on a trusted group only:
   * `ProjectErrorAccess.assertAgentMayRead`.
   */
  protected assertAgentMayRead(
    row: ProjectError,
    user: UserAccountToken | undefined,
  ): Promise<void> {
    return this.access.assertAgentMayRead(row, user);
  }

  /**
   * The names of the members who trusted these groups, by id.
   */
  protected async trusters(rows: ProjectError[]): Promise<Map<string, string>> {
    const ids = [
      ...new Set(rows.map((row) => row.trustedBy).filter(Boolean)),
    ] as string[];
    if (!ids.length) return new Map();
    const found = await this.users.findMany({
      where: { id: { inArray: ids } },
    });
    return new Map(
      found.map((it) => [
        it.id,
        (it as { name?: string; username?: string; email?: string }).name ??
          (it as { username?: string }).username ??
          "",
      ]),
    );
  }

  /**
   * Each group tied to the group on the other side of the same request
   * (#Q4404): a browser error and a server error carrying one `requestId`.
   * Read over every group the caller may see, resolved ones included, so a
   * browser error still names the server error that caused it once that one
   * is resolved.
   */
  protected linkedErrors(
    rows: ProjectError[],
  ): Map<number, { id: number; origin: ProjectError["origin"] }> {
    const byRequest = new Map<string, ProjectError[]>();
    for (const row of rows) {
      if (!row.requestId) continue;
      const group = byRequest.get(row.requestId) ?? [];
      group.push(row);
      byRequest.set(row.requestId, group);
    }
    const linked = new Map<
      number,
      { id: number; origin: ProjectError["origin"] }
    >();
    for (const group of byRequest.values()) {
      for (const row of group) {
        const across = group.filter(
          (it) =>
            it.id !== row.id &&
            (it.origin === "server") !== (row.origin === "server"),
        );
        // One batch is one request: two actions failing in it give two groups
        // on each side under one id. The route then says which pairs with
        // which; with a single group across, it is that one.
        const other =
          across.length === 1
            ? across[0]
            : across.find((it) => this.routePath(it) === this.routePath(row));
        if (other) linked.set(row.id, { id: other.id, origin: other.origin });
      }
    }
    return linked;
  }

  /**
   * The path a group failed on: a browser group's route without its method
   * (`GET /api/prompts`), a server group's `sourceUrl` (`/api/prompts`).
   */
  protected routePath(row: ProjectError): string | undefined {
    if (row.route) return row.route.split(" ").at(-1);
    return row.origin === "server" ? row.sourceUrl || undefined : undefined;
  }

  /**
   * Resolved, and reported again since (#Q4466). Read from the row, so the
   * list and the single read agree and the ingest writes nothing more. The
   * dates are compared as instants: both are ISO strings, written by
   * different paths.
   */
  protected seenAgain(
    row: Pick<ProjectError, "status" | "resolvedAt" | "lastSeenAt">,
  ): boolean {
    if (row.status !== "resolved" || !row.resolvedAt) return false;
    return Date.parse(row.lastSeenAt) > Date.parse(row.resolvedAt);
  }

  protected toResource(
    b: ProjectError,
    trusters: Map<string, string> = new Map(),
  ): ProjectErrorResource {
    return {
      id: b.id,
      sigilId: b.sigilId,
      fingerprint: b.fingerprint,
      name: b.name,
      message: b.message,
      stack: b.stack ?? "",
      sourceUrl: b.sourceUrl ?? "",
      firstSeenAt: b.firstSeenAt,
      lastSeenAt: b.lastSeenAt,
      count: b.count ?? 1,
      status: b.status ?? "open",
      origin: b.origin ?? "client",
      ...(b.resolvedAt ? { resolvedAt: b.resolvedAt } : {}),
      ...(this.seenAgain(b) ? { seenAgain: true } : {}),
      ...(b.trustedAt ? { trustedAt: b.trustedAt } : {}),
      ...(b.trustedBy ? { trustedBy: b.trustedBy } : {}),
      ...(b.trustedBy && trusters.get(b.trustedBy)
        ? { trustedByName: trusters.get(b.trustedBy) }
        : {}),
      ...(b.action ? { action: b.action } : {}),
      ...(b.route ? { route: b.route } : {}),
      ...(b.requestId ? { requestId: b.requestId } : {}),
      ...(b.useCaseRunId != null ? { useCaseRunId: b.useCaseRunId } : {}),
      ...(b.criterionKey ? { criterionKey: b.criterionKey } : {}),
    };
  }

  protected toRuleResource(
    r: ProjectErrorIgnoreRule,
  ): ProjectErrorRuleResource {
    return {
      id: r.id,
      pattern: r.pattern,
      createdAt: r.createdAt,
    };
  }

  /**
   * `text` as a fenced block no content can close: the fence is one backtick
   * longer than the longest run of backticks in it, and at least three.
   */
  protected codeFence(text: string): string {
    const fence = "`".repeat(Math.max(3, this.longestBacktickRun(text) + 1));
    return `${fence}\n${text}\n${fence}`;
  }

  /**
   * `text` as an inline code span, on one line, delimited by more backticks
   * than it contains in a row, and padded so a leading or trailing backtick
   * cannot merge with the delimiter.
   */
  protected codeSpan(text: string): string {
    const line = text.replace(/[\r\n]+/g, " ");
    const ticks = "`".repeat(this.longestBacktickRun(line) + 1);
    return `${ticks} ${line} ${ticks}`;
  }

  protected longestBacktickRun(text: string): number {
    return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  }
}
