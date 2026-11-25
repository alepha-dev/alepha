import {
  ResourceRegistry,
  $ownsProject,
  JobKeyService,
  McpProjectScope,
  ProjectSecurityService,
} from "@lore/core/api";
import { $inject, z } from "alepha";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbEntityNotFoundError } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  okSchema,
} from "alepha/server";

import type { ProjectErrorIgnoreRule } from "../entities/projectErrorIgnoreRules.ts";
import { type ProjectError, projectErrors } from "../entities/projectErrors.ts";
import { sigils } from "../entities/sigils.ts";
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
import { ProjectErrorRuleService } from "../services/ProjectErrorRuleService.ts";

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
  protected jobKeys = $inject(JobKeyService);
  protected scope = $inject(McpProjectScope);
  protected users = $repository(users);
  protected dateTime = $inject(DateTimeProvider);

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
          orderBy: [{ column: "count", direction: "desc" }],
        })
      ).sort((a, b) => b.count - a.count);
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
      await this.currentProjectErrors.updateById(projectError.id, {
        status: "resolved",
      });
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
      await this.currentProjectErrors.updateById(projectError.id, {
        trustedAt,
        trustedBy: user.id,
      });
      return { trustedAt, trustedBy: user.id };
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
    handler: async ({ params }) => {
      const projectError = await this.loadProjectError(
        params.projectId,
        params.errorId,
      );
      if (projectError.trustedAt) {
        await this.currentProjectErrors.updateById(projectError.id, {
          trustedAt: null,
          trustedBy: null,
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
          { status: `${QUEST_STATUS_PREFIX}${quest.id}` },
        );
      } catch (error) {
        if (!(error instanceof DbEntityNotFoundError)) throw error;
        await questKind.discard!(quest.id);
        throw new BadRequestError("Error already forwarded to a quest");
      }

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
        { status: `${QUEST_STATUS_PREFIX}${quest.id}` },
      );
    } catch (error) {
      if (!(error instanceof DbEntityNotFoundError)) throw error;
      await questKind.disown!(quest.id);
      throw new BadRequestError("Error already forwarded to a quest");
    }
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
   * Load an error by id, asserting it belongs to the expected project.
   * Returns 404 otherwise — never leaks cross-project rows.
   *
   * The project scope is a column rather than a join: an error carries its own
   * `projectId`, so cross-project leakage is one WHERE clause instead of a
   * two-step lookup that could be got wrong — and it still answers for an error
   * whose sigil has since been deleted.
   */
  protected async loadProjectError(projectId: number, errorId: number) {
    const projectError = await this.currentProjectErrors.findOne({
      where: { id: { eq: errorId }, projectId: { eq: projectId } },
    });
    if (!projectError) {
      throw new NotFoundError("Error not found");
    }
    return projectError;
  }

  /**
   * Whether a model is reading (#Q4233, #Q4235): an agent job's key, or a
   * run pinned to one project, which is what a chat agent answering in a
   * room runs under (`McpProjectScope.pinned`). A member's own MCP client
   * is neither, and reads the inbox as the page does.
   */
  protected async isAgent(
    user: UserAccountToken | undefined,
  ): Promise<boolean> {
    if (this.scope.pinnedProject() !== undefined) return true;
    return Boolean(await this.jobKeys.scopeOf(user));
  }

  /**
   * An agent acts on a trusted group only (#Q4233): forwarding copies the
   * group's text into a quest, and resolving needs it read.
   */
  protected async assertAgentMayRead(
    row: ProjectError,
    user: UserAccountToken | undefined,
  ): Promise<void> {
    if (row.trustedAt) return;
    if (await this.isAgent(user)) {
      throw new ForbiddenError(
        `Error ${row.id} is not trusted yet: a member reads and trusts it before an agent acts on it`,
      );
    }
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
      ...(b.trustedAt ? { trustedAt: b.trustedAt } : {}),
      ...(b.trustedBy ? { trustedBy: b.trustedBy } : {}),
      ...(b.trustedBy && trusters.get(b.trustedBy)
        ? { trustedByName: trusters.get(b.trustedBy) }
        : {}),
      ...(b.action ? { action: b.action } : {}),
      ...(b.route ? { route: b.route } : {}),
      ...(b.requestId ? { requestId: b.requestId } : {}),
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
