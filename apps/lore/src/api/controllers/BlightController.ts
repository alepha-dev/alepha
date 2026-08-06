import { $inject, type Infer, z } from "alepha";
import { $logger } from "alepha/logger";
import { $repository, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  NotFoundError,
  okSchema,
} from "alepha/server";
import type { BlightIgnoreRule } from "../entities/blightIgnoreRules.ts";
import {
  type Blight,
  blights,
  QUEST_STATUS_PREFIX,
} from "../entities/blights.ts";
import { sigils } from "../entities/sigils.ts";
import { BlightRuleService } from "../services/BlightRuleService.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { QuestService } from "../services/QuestService.ts";

/** Zone every blight-forwarded quest is filed under — predictable triage. */
const BLIGHT_ZONE = "Blights";

/**
 * A blight row as exposed to the project owner's Blights inbox. Mirrors
 * the entity 1:1 — every field is included, but the UI must render
 * `name`, `message`, `stack` and `sourceUrl` as escaped plain text only
 * (attacker-controlled — see folio #12 + the entity-level note).
 */
const blightResourceSchema = z.object({
  id: z.integer(),
  /**
   * Which app reported it last.
   *
   * A blight is one row per project and per fingerprint, so a bug present in
   * two enrolled apps is one triage decision; this names the sigil
   * that most recently saw it, which is what the inbox's filter means. The
   * per-app breakdown lives in `sigil_error_groups`.
   */
  sigilId: z.uuid().optional(),
  fingerprint: z.string(),
  name: z.string(),
  message: z.string(),
  stack: z.string(),
  sourceUrl: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  count: z.integer(),
  status: z.string(),
  origin: z.enum(["client", "server"]),
});

export type BlightResource = Infer<typeof blightResourceSchema>;

/**
 * A sigil reduced to what the inbox's "filter by sigil" dropdown needs —
 * id + label.
 *
 * Returned alongside the blight list rather than fetched from
 * `SigilController.listSigils`, which is member-readable but answers with the
 * whole credential row: token prefix, kinds, creator, last-seen. A dropdown
 * needs two fields, and one request beats two.
 */
const blightSigilSchema = z.object({
  id: z.uuid(),
  label: z.string(),
});

/** A project-wide blight ignore rule as exposed to the owner. */
const blightRuleResourceSchema = z.object({
  id: z.integer(),
  pattern: z.string(),
  createdAt: z.string(),
});

export type BlightRuleResource = Infer<typeof blightRuleResourceSchema>;

/**
 * Owner-facing triage surface for blights — the deduplicated uncaught
 * exceptions captured by a project's sigils.
 *
 * Read endpoints (list + count) are member-gated via
 * `ProjectSecurityService.assertMember` so any project member can view the
 * inbox; mutations (resolve/forward/delete) stay owner-only via
 * `assertOwner`. A blight carries its own `projectId`, so the scope is a
 * WHERE clause rather than a walk through the project's sigils — one less
 * step to get wrong, and it keeps working for a blight whose sigil has since
 * been deleted.
 *
 * ⚠️ SECURITY: `name`, `message`, `stack`, `sourceUrl` on a blight row are
 * 100% attacker-controlled. They are persisted verbatim and shown to the
 * project owner (the highest-value target). They must only ever be
 * rendered as escaped plain text — never markdown / `dangerouslySetInnerHTML`.
 * The forward-to-quest description embeds the stack as plain text too.
 * See folio #12.
 */
export class BlightController {
  protected log = $logger();
  protected currentBlights = $repository(blights);
  protected sigils = $repository(sigils);
  protected security = $inject(ProjectSecurityService);
  protected questService = $inject(QuestService);
  protected ruleService = $inject(BlightRuleService);

  /**
   * List blights for a project, newest-spread first (`count` desc).
   * Open-only by default; `includeResolved` also returns `resolved` and
   * `quest:*` rows. Owner-only.
   */
  listBlights = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/blights",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        includeResolved: z.boolean().optional(),
      }),
      response: z.object({
        items: z.array(blightResourceSchema),
        openCount: z.integer(),
        sigils: z.array(blightSigilSchema),
      }),
    },
    handler: async ({ params, query, user }) => {
      await this.security.assertMember(params.projectId, user);

      const all = (
        await this.currentBlights.findMany({
          where: { projectId: { eq: params.projectId } },
          orderBy: [{ column: "count", direction: "desc" }],
        })
      ).sort((a, b) => b.count - a.count);

      // The inbox's filter options: which apps report here. Listed even when
      // they have filed nothing, so an owner can tell an app that is quiet from
      // one that was never enrolled.
      //
      // The wire field stays `label` — it is what the filter shows, and renaming
      // it would break every MCP client reading `blight_list` — but its value is
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

      return {
        items: items.map((b) => this.toResource(b)),
        openCount,
        sigils: sigilOptions,
      };
    },
  });

  /**
   * Count of `open` blights for a project — feeds the sidebar badge.
   * Readable by any project member.
   */
  countOpenBlights = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/blights/count",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ count: z.integer() }),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);

      // One read of the live table, matching the inbox. The two-hop count
      // through sigils would now return zero for every project, because
      // nothing has written to that table since Lore stopped ingesting — the
      // badge would sit at 0 over a full inbox.
      const open = await this.currentBlights.findMany({
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
   * Resolve a blight — `status = "resolved"`. The row stays for audit; the
   * default inbox view hides it. Owner-only.
   */
  resolveBlight = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "POST",
    path: "/projects/:projectId/blights/:blightId/resolve",
    schema: {
      params: z.object({
        projectId: z.integer(),
        blightId: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.projectId, user);
      const blight = await this.loadBlight(params.projectId, params.blightId);
      await this.currentBlights.updateById(blight.id, { status: "resolved" });
      return { ok: true };
    },
  });

  /**
   * Forward a blight to a new quest. Creates a quest in the project with
   * the blight's name/message as the title and the stack + spread summary
   * as the (plain-text) description, links the quest back via
   * `quests.source.sigilBlightId`, and flips the blight to
   * `status = "quest:<id>"`. Owner-only.
   */
  forwardBlightToQuest = $action({
    use: [$secure({ permissions: ["quest:create"] }), $transactional()],
    method: "POST",
    path: "/projects/:projectId/blights/:blightId/forward",
    schema: {
      params: z.object({
        projectId: z.integer(),
        blightId: z.integer(),
      }),
      response: z.object({ questId: z.integer(), questShortId: z.integer() }),
    },
    handler: async ({ params, user }) => {
      const { project } = await this.security.assertOwner(
        params.projectId,
        user,
      );
      const blight = await this.loadBlight(params.projectId, params.blightId);

      if (blight.status.startsWith(QUEST_STATUS_PREFIX)) {
        throw new BadRequestError("Blight already forwarded to a quest");
      }

      // Title: `[Blight] TypeError: cannot read…` — name + message,
      // truncated. Plain text, never rendered as markdown.
      const summary = [blight.name, blight.message]
        .filter((s) => s.trim().length > 0)
        .join(": ");
      const title = `[Blight] ${summary}`.slice(0, 200);

      // Description: attacker-controlled stack embedded as PLAIN TEXT.
      // The quest description is markdown-rendered downstream, so the
      // stack goes inside a fenced code block — fences make the content
      // verbatim/escaped and a stray ``` inside the stack is harmless
      // (it just ends the block early; no markup is interpreted).
      const description = [
        `Forwarded from blight #${blight.id} (${blight.fingerprint.slice(0, 12)}…).`,
        "",
        `Seen ${blight.count} time(s), last on ${blight.lastSeenAt}.`,
        "",
        blight.sourceUrl ? `Source: ${blight.sourceUrl}` : "",
        "",
        "Stack:",
        "```",
        blight.stack || "(no stack captured)",
        "```",
      ]
        .join("\n")
        .slice(0, 10_000);

      // Blight-forwarded quests always land in a dedicated "Blights" zone
      // (created on the project if absent) — predictable triage, not
      // whatever the project's arbitrary first zone happens to be.
      // Creation mechanics (shortId, zone-ensure, sanitizeHtml, defaults)
      // are shared with QuestController.createQuest via QuestService.
      const quest = await this.questService.createQuest(project, {
        projectId: params.projectId,
        title,
        description,
        zone: BLIGHT_ZONE,
        priority: "medium",
        difficulty: 2,
        tags: ["bug", "blight"],
        createdBy: user.id,
        source: { sigilBlightId: blight.id },
      });

      await this.currentBlights.updateById(blight.id, {
        status: `${QUEST_STATUS_PREFIX}${quest.id}`,
      });

      return { questId: quest.id, questShortId: quest.shortId };
    },
  });

  /**
   * Hard-delete a blight row. Owner-only.
   */
  deleteBlight = $action({
    use: [$secure({ permissions: ["project:delete"] })],
    method: "DELETE",
    path: "/projects/:projectId/blights/:blightId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        blightId: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.projectId, user);
      const blight = await this.loadBlight(params.projectId, params.blightId);
      await this.currentBlights.deleteById(blight.id);
      return { ok: true };
    },
  });

  /**
   * Mass-delete blights by id. Each id is validated to belong to the project
   * (the `projectId` filter is the cross-project guard), so stray ids are
   * silently skipped rather than leaking or 404-ing the whole batch.
   * Owner-only. Returns how many rows were actually removed.
   */
  deleteBlights = $action({
    use: [$secure({ permissions: ["project:delete"] })],
    method: "DELETE",
    path: "/projects/:projectId/blights",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        ids: z.array(z.integer()).min(1).max(200),
      }),
      response: z.object({ deleted: z.integer() }),
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.projectId, user);
      // Scoped by `projectId`, not by the project's sigil ids: a blight whose
      // sigil was deleted keeps `projectId` and loses `sigilId`, and the
      // sigil-list version silently refused to delete exactly those rows.
      const rows = await this.currentBlights.findMany({
        where: {
          id: { inArray: body.ids },
          projectId: { eq: params.projectId },
        },
      });
      for (const row of rows) {
        await this.currentBlights.deleteById(row.id);
      }
      return { deleted: rows.length };
    },
  });

  /**
   * List the project's blight ignore rules — the message substrings that
   * drop matching crashes at ingestion. Readable by any project member (the
   * inbox surfaces them in the rules dialog); mutations stay owner-only.
   */
  listBlightRules = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/blights/rules",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(blightRuleResourceSchema) }),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);
      const rules = await this.ruleService.listForProject(params.projectId);
      return { items: rules.map((r) => this.toRuleResource(r)) };
    },
  });

  /**
   * Add a blight ignore rule. The `pattern` is a case-insensitive substring
   * matched against an incoming crash's `message`; matching events are dropped
   * at ingestion going forward (existing rows are untouched — use mass-delete
   * to clear them). Owner-only.
   */
  createBlightRule = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "POST",
    path: "/projects/:projectId/blights/rules",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        pattern: z.string().min(1).max(200),
      }),
      response: blightRuleResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.projectId, user);
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
   * Delete a blight ignore rule. Owner-only.
   */
  deleteBlightRule = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "DELETE",
    path: "/projects/:projectId/blights/rules/:ruleId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        ruleId: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.projectId, user);
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
   * Load a blight by id, asserting it belongs to the expected project.
   * Returns 404 otherwise — never leaks cross-project rows.
   *
   * The project scope is a column rather than a join: a blight carries its own
   * `projectId`, so cross-project leakage is one WHERE clause instead of a
   * two-step lookup that could be got wrong — and it still answers for a blight
   * whose sigil has since been deleted.
   */
  protected async loadBlight(projectId: number, blightId: number) {
    const blight = await this.currentBlights.findOne({
      where: { id: { eq: blightId }, projectId: { eq: projectId } },
    });
    if (!blight) {
      throw new NotFoundError("Blight not found");
    }
    return blight;
  }

  protected toResource(b: Blight): BlightResource {
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
    };
  }

  protected toRuleResource(r: BlightIgnoreRule): BlightRuleResource {
    return {
      id: r.id,
      pattern: r.pattern,
      createdAt: r.createdAt,
    };
  }
}
