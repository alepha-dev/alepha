import { $inject, z } from "alepha";
import { $storage, FileService, files } from "alepha/api/files";
import { $logger } from "alepha/logger";
import {
  $repository,
  $sequence,
  $transactional,
  db,
  pageQuerySchema,
} from "alepha/orm";
import { $secure, type UserAccountToken } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  okSchema,
} from "alepha/server";
import { FileSystemProvider } from "alepha/system";

import { type Feedback, feedback } from "../entities/feedback.ts";
import { type Project, projects } from "../entities/projects.ts";
import type { Quest } from "../entities/quests.ts";
import type { User } from "../entities/users.ts";
import { relations } from "../relations.ts";
import {
  type FeedbackResource,
  feedbackResourceSchema,
} from "../schemas/feedbackResourceSchema.ts";
import { feedbackSourceSchema } from "../schemas/feedbackSourceSchema.ts";
import {
  type MyFeedbackResource,
  myFeedbackResourceSchema,
} from "../schemas/myFeedbackResourceSchema.ts";
import { FeedbackRateLimiter } from "../services/FeedbackRateLimiter.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

const feedbackBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  attachments: z.array(z.uuid()).optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  /**
   * Provenance of an embedded submission. Absent for first-party feedback.
   * The fields are attacker-controlled (set by the embedding page) — they
   * are persisted verbatim and must only ever be rendered as escaped plain
   * text. See `feedback.source` + folio #12.
   */
  source: feedbackSourceSchema.optional(),
});

/**
 * A feedback row carrying the relations a resource needs, as `include`
 * returns them.
 *
 * Written out rather than inferred so the mappers below state their input
 * instead of inheriting it from whichever call site was edited last.
 */
type FeedbackWithRelations = Feedback & {
  reporter?: User;
  linkedQuests: Array<Quest>;
};

type MyFeedbackWithRelations = FeedbackWithRelations & {
  project?: Project;
};

/**
 * Feedback endpoints. All endpoints require authentication — there is no
 * anonymous / embed-token path. External "report a bug" links are expected to
 * be plain `<a href="/p/:id/request?path=...">` anchors that drop the user on
 * the in-app request form after a one-tap Google login.
 */
export class FeedbackController {
  protected log = $logger();
  protected feedback = $repository(feedback);
  /**
   * The same table, with `include`. Reads that need a feedback row's
   * reporter, project or linked quests go through this one, so the join
   * happens in the statement instead of in three follow-up queries and three
   * Maps.
   */
  protected feedbackWith = $repository(relations, "feedback");
  protected projects = $repository(projects);
  protected fileRepo = $repository(files);

  /**
   * What every feedback read needs alongside the row itself. Declared once so
   * the four entry points cannot drift apart -- they all feed the same mapper.
   */
  protected static readonly withRelations = {
    reporter: true,
    linkedQuests: { orderBy: { column: "createdAt", direction: "asc" } },
  } as const;

  /** ...plus the owning project, for the reporter's cross-project list. */
  protected static readonly withRelationsAndProject = {
    ...FeedbackController.withRelations,
    project: true,
  } as const;

  protected rateLimiter = $inject(FeedbackRateLimiter);
  protected security = $inject(ProjectSecurityService);
  protected fileService = $inject(FileService);
  protected fileSystem = $inject(FileSystemProvider);

  /**
   * Per-project sequence for `feedback.shortId`. Used in MCP responses and
   * UI display so reporters can reference "feedback #5 in Lore".
   *
   * Renamed from `petitionShortId` in the 2026-08 great rename. `$sequence`
   * keys its counter on the property name, so the migration carries an
   * `UPDATE alepha_sequences SET name = 'feedbackShortId' WHERE name =
   * 'petitionShortId'` — without it every existing project restarts at 1
   * and collides with its own history. Renaming this property again needs
   * the same treatment.
   */
  protected feedbackShortId = $sequence();

  /**
   * Bucket for feedback attachments. Size cap mirrors `feedbackOptionsAtom`
   * — the bucket-level limit acts as a hard backstop in case the controller
   * check is bypassed. MIME whitelist is enforced at upload time (not here)
   * so it can read from the atom rather than baking values into `$storage`.
   */
  attachmentBucket = $storage({
    name: FeedbackRateLimiter.ATTACHMENT_BUCKET,
    maxSize: 5,
  });

  /**
   * Submit feedback for a project. Any logged-in Lore user can submit so
   * long as the target project has the feedback module enabled
   * (`features.feedback === true`). Membership is NOT required — feedback
   * is explicitly the "outside-the-team feedback channel". The feedback
   * module toggle is the project owner's only opt-in/out lever.
   *
   * The per-user daily rate limit applies only to NON-members: owners and
   * members belong to the project and submit without limit. Exceeding the
   * limit yields a 429 (whose message survives to the client), not a 500.
   */
  submitFeedback = $action({
    use: [$secure(), $transactional()],
    method: "POST",
    path: "/projects/:projectId/feedback",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: feedbackBodySchema,
      response: z.object({ id: z.integer() }),
    },
    handler: async ({ params, body, user }) => {
      await this.assertFeedbackOpen(params.projectId);

      // The feedback rate limit only throttles outsiders — feedback is the
      // "outside-the-team feedback channel". Project owners/members belong to
      // the project and submit without limit.
      if (!(await this.security.isMember(params.projectId, user))) {
        await this.rateLimiter.assertFeedbackAllowed(user.id);
      }

      const limits = this.rateLimiter.options();
      const attachments = body.attachments ?? [];
      if (attachments.length > limits.maxAttachmentsPerFeedback) {
        throw new BadRequestError(
          `Too many attachments (max ${limits.maxAttachmentsPerFeedback})`,
        );
      }

      if (attachments.length > 0) {
        await this.assertAttachmentsBelongToUser(attachments, user.id);
      }

      const shortId = await this.feedbackShortId.next(String(params.projectId));

      const created = await this.feedback.create({
        projectId: params.projectId,
        shortId,
        reporterUserId: user.id,
        title: body.title.slice(0, 200),
        description: body.description.slice(0, 10_000),
        status: "pending",
        attachments,
        tags: (body.tags ?? []).slice(0, 20),
        source: body.source,
      });

      return { id: created.id };
    },
  });

  /**
   * Minimal public project info for the feedback request page. The page is
   * a top-level route (not under the `project` layout) so it has no project
   * data — and it must work for non-members. Gated EXACTLY like
   * `submitFeedback`: any logged-in user, but only when the project has the
   * feedback module on. Returns the title + icon needed to render the
   * "you're submitting to X" header, plus the two attachment limits the form
   * has to state.
   *
   * The limits are here rather than hardcoded in the browser because the form
   * *quotes them to the user* ("max 5 MB each, up to 10 files") while the
   * server enforces them from `feedbackOptionsAtom` — which is `serverOnly`
   * and overridable per deployment. Three copies of the same number (the
   * atom, the client constant, the sentence) is two too many: whichever
   * deployment tunes the atom would have had the form confidently quote the
   * wrong cap, and the user would only discover it on a rejected upload.
   */
  /**
   * Addressed by **slug**, unlike every other endpoint on this controller.
   *
   * The request form at `/:projectSlug/request` is the one project surface
   * that sits outside the `project` route layout — it has to stay reachable
   * without membership, so it never runs that layout's loader and has no
   * `currentProjectAtom` to read an id from. This endpoint is the page's only
   * way to turn the slug in its URL into the integer `projectId` that
   * `submitFeedback` and `uploadFeedbackAttachment` still take; both of those
   * are unchanged.
   *
   * Still `$secure()` and still gated on `assertFeedbackOpen`, so the
   * disclosure surface is unchanged in kind — an id probe became a slug probe.
   */
  feedbackContext = $action({
    use: [$secure()],
    method: "GET",
    path: "/projects/by-slug/:slug/feedback/context",
    schema: {
      params: z.object({ slug: z.string() }),
      response: z.object({
        /**
         * The integer id the submit and attachment-upload endpoints take.
         * Returned here because the page has no other way to learn it.
         */
        projectId: z.integer(),
        title: z.string(),
        icon: z.union([z.uuid(), z.null()]).optional(),
        maxAttachments: z.integer(),
        maxFileSizeMb: z.integer(),
      }),
    },
    handler: async ({ params }) => {
      // Soft-deleted rows are filtered out by the repository, and a rename
      // frees the old slug — so neither a deleted nor a renamed project
      // answers on a stale URL.
      const found = await this.projects.findOne({
        where: { slug: { eq: params.slug } },
      });
      if (!found) {
        throw new NotFoundError("Project not found");
      }

      const project = await this.assertFeedbackOpen(found.id);
      const limits = this.rateLimiter.options();
      return {
        projectId: project.id,
        title: project.title,
        icon: project.icon ?? null,
        maxAttachments: limits.maxAttachmentsPerFeedback,
        maxFileSizeMb: Math.floor(limits.maxFileSizeBytes / (1024 * 1024)),
      };
    },
  });

  /**
   * Upload a single attachment for a future feedback. Returns a file id that
   * the client passes back in `submit.body.attachments`. Per-user daily upload
   * rate limit applies. MIME + extension are both checked against the
   * `feedbackOptionsAtom` whitelist.
   */
  uploadFeedbackAttachment = $action({
    use: [$secure()],
    method: "POST",
    path: "/projects/:projectId/feedback/attachments",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        file: z.file(),
      }),
      response: z.object({
        id: z.uuid(),
        name: z.string(),
        size: z.number(),
        mimeType: z.string(),
      }),
    },
    handler: async ({ params, body, user }) => {
      await this.assertFeedbackOpen(params.projectId);
      // Members are exempt from the upload throttle too (same rationale as
      // submitFeedback) — the limit is an outsider control.
      if (!(await this.security.isMember(params.projectId, user))) {
        await this.rateLimiter.assertAttachmentAllowed(user.id);
      }

      const limits = this.rateLimiter.options();
      const file = body.file;

      if (file.size > limits.maxFileSizeBytes) {
        throw new BadRequestError(
          `File too large (max ${Math.round(limits.maxFileSizeBytes / 1024 / 1024)} MB)`,
        );
      }

      if (!limits.allowedMimeTypes.includes(file.type)) {
        throw new BadRequestError(`File type not allowed: ${file.type}`);
      }

      const ext = this.extractExtension(file.name);
      if (!ext || !limits.allowedExtensions.includes(ext)) {
        throw new BadRequestError(`File extension not allowed: .${ext ?? ""}`);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const reusable = this.fileSystem.createFile({
        buffer,
        name: file.name,
        type: file.type,
      });

      const stored = await this.attachmentBucket.upload(reusable, {
        // Stamp the uploader so `assertAttachmentsBelongToUser` can verify
        // the claim at submit time — without it `creator` is null and every
        // attachment claim is rejected as "invalid".
        user,
      });

      return {
        id: stored.id,
        name: stored.name,
        size: stored.size,
        mimeType: stored.mimeType,
      };
    },
  });

  /**
   * List feedback for a project, filtered by status. Readable by any
   * project member; triage (accept/reject/remove) stays owner-only.
   */
  listFeedback = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/feedback",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        status: z
          .enum(["pending", "accepted", "rejected", "all"])
          .meta({ mode: "text" })
          .optional(),
      }),
      response: z.object({ items: z.array(feedbackResourceSchema) }),
    },
    handler: async ({ params, query, user }) => {
      await this.ensureMember(params.projectId, user);

      const status = query.status ?? "pending";
      const where = this.feedback.createQueryWhere();
      where.projectId = { eq: params.projectId };
      if (status !== "all") {
        where.status = { eq: status };
      }

      const items = await this.feedbackWith.findMany({
        where,
        orderBy: [{ column: "createdAt", direction: "desc" }],
        include: FeedbackController.withRelations,
      });

      return { items: await this.toResources(items) };
    },
  });

  /**
   * Fetch a single feedback by id, scoped to its project. Readable by
   * any project member.
   */
  getFeedback = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/feedback/:feedbackId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        feedbackId: z.integer(),
      }),
      response: feedbackResourceSchema,
    },
    handler: async ({ params, user }) => {
      await this.ensureMember(params.projectId, user);
      const feedback = await this.loadFeedback(
        params.projectId,
        params.feedbackId,
      );
      const [resource] = await this.toResources([feedback]);
      return resource;
    },
  });

  /**
   * Read a single feedback attachment's bytes (base64) plus its metadata.
   * Project-member gated, with an IDOR guard: the `attachmentId` must be one
   * of that feedback row's own `attachments`. Backs the
   * `feedback_attachment_get` MCP tool, which wraps the bytes into an MCP
   * `image` content block so an agent can actually see the screenshot. The
   * 5 MB upload cap bounds the base64 payload (~6.7 MB).
   */
  getFeedbackAttachment = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/feedback/:feedbackId/attachments/:attachmentId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        feedbackId: z.integer(),
        attachmentId: z.uuid(),
      }),
      response: z.object({
        id: z.uuid(),
        name: z.string(),
        mimeType: z.string(),
        size: z.number(),
        data: z.string().describe("Base64-encoded file bytes."),
      }),
    },
    handler: async ({ params, user }) => {
      await this.ensureMember(params.projectId, user);
      const feedback = await this.loadFeedback(
        params.projectId,
        params.feedbackId,
      );

      // IDOR guard: only attachments that belong to THIS feedback are
      // readable — a member can't read an arbitrary file id this way.
      if (!(feedback.attachments ?? []).includes(params.attachmentId)) {
        throw new NotFoundError("Attachment not found on this feedback");
      }

      const file = await this.fileRepo.findOne({
        where: { id: { eq: params.attachmentId } },
      });
      if (!file) {
        throw new NotFoundError("Attachment file missing");
      }

      // `$storage.download` takes the file row (or its id) and resolves the
      // blob itself — `blobId` is an internal storage detail now. Passing the
      // already-loaded row avoids a second lookup.
      const blob = await this.attachmentBucket.download(file);
      const data = Buffer.from(await blob.arrayBuffer()).toString("base64");

      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        data,
      };
    },
  });

  /**
   * Accept a feedback item — owner declares the request valid. Status flips
   * `pending → accepted`; quests are created separately via the regular
   * `createQuest` flow, passing `feedbackId` so the spawned work links back
   * to this feedback item. A single feedback item can spawn many quests.
   *
   * Owner-only.
   */
  acceptFeedback = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "POST",
    path: "/projects/:projectId/feedback/:feedbackId/accept",
    schema: {
      params: z.object({
        projectId: z.integer(),
        feedbackId: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.ensureOwner(params.projectId, user);
      const feedback = await this.loadFeedback(
        params.projectId,
        params.feedbackId,
      );

      if (feedback.status !== "pending") {
        throw new BadRequestError("Feedback already triaged");
      }

      await this.feedback.updateById(feedback.id, { status: "accepted" });
      return { ok: true };
    },
  });

  /**
   * Reject a feedback item — soft state transition, the row remains for
   * audit. Owner-only.
   */
  rejectFeedback = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "POST",
    path: "/projects/:projectId/feedback/:feedbackId/reject",
    schema: {
      params: z.object({
        projectId: z.integer(),
        feedbackId: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.ensureOwner(params.projectId, user);
      const feedback = await this.loadFeedback(
        params.projectId,
        params.feedbackId,
      );

      await this.feedback.updateById(feedback.id, { status: "rejected" });
      return { ok: true };
    },
  });

  /**
   * Soft-delete a feedback row. Owner-only.
   */
  removeFeedback = $action({
    use: [$secure({ permissions: ["project:delete"] })],
    method: "DELETE",
    path: "/projects/:projectId/feedback/:feedbackId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        feedbackId: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.ensureOwner(params.projectId, user);
      const feedback = await this.loadFeedback(
        params.projectId,
        params.feedbackId,
      );
      await this.feedback.deleteById(feedback.id);
      return { ok: true };
    },
  });

  /**
   * Reporter-facing list of the caller's OWN feedback across every project
   * they submitted to (the `/me` profile page). Paginated for `AlephaTable`,
   * with optional search / status / project filters. No membership needed —
   * feedback belongs to its reporter regardless of project membership.
   */
  listMyFeedback = $action({
    use: [$secure()],
    method: "GET",
    path: "/me/feedback",
    schema: {
      query: pageQuerySchema.extend({
        search: z.string().optional(),
        status: z
          .enum(["pending", "accepted", "rejected", "all"])
          .meta({ mode: "text" })
          .optional(),
        projectId: z.integer().optional(),
      }),
      response: db.page(myFeedbackResourceSchema),
    },
    handler: async ({ query, user }) => {
      const where = this.feedback.createQueryWhere();
      where.reporterUserId = { eq: user.id };

      if (query.search) {
        where.title = { ilike: `%${query.search}%` };
      }
      if (query.status && query.status !== "all") {
        where.status = { eq: query.status };
      }
      if (query.projectId) {
        where.projectId = { eq: query.projectId };
      }

      query.sort ??= "-createdAt";

      const result = await this.feedbackWith.paginate(
        query,
        { where, include: FeedbackController.withRelationsAndProject },
        { count: true },
      );

      return {
        ...result,
        content: await this.toMyResources(result.content),
      };
    },
  });

  /**
   * The distinct projects the caller has feedback in — drives the project
   * filter dropdown on the `/me` feedback page. A reporter may have
   * submitted feedback to projects they are not a member of, so this can't
   * be derived from the user's own project list.
   */
  listMyFeedbackProjects = $action({
    use: [$secure()],
    method: "GET",
    path: "/me/feedback-projects",
    schema: {
      response: z.object({
        items: z.array(
          z.object({
            id: z.integer(),
            title: z.string(),
            icon: z.union([z.uuid(), z.null()]).optional(),
          }),
        ),
      }),
    },
    handler: async ({ user }) => {
      const rows = await this.feedback.findMany({
        where: { reporterUserId: { eq: user.id } },
        columns: ["projectId"],
      });
      const ids = [...new Set(rows.map((r) => r.projectId))];
      if (ids.length === 0) return { items: [] };

      const camps = await this.projects.findMany({
        where: { id: { inArray: ids } },
        orderBy: [{ column: "title", direction: "asc" }],
      });
      return {
        items: camps.map((c) => ({
          id: c.id,
          title: c.title,
          icon: c.icon ?? null,
        })),
      };
    },
  });

  /**
   * Edit one of the caller's own feedback items. Allowed only while the
   * feedback is still `pending` — once the owner triages it (accepted →
   * quest, or rejected) it is locked. Reporter-only: a feedback item the
   * caller didn't submit 404s (never 403 — avoids leaking existence).
   */
  updateMyFeedback = $action({
    use: [$secure()],
    method: "POST",
    path: "/me/feedback/:feedbackId",
    schema: {
      params: z.object({ feedbackId: z.integer() }),
      body: z.object({
        title: z.string().min(1).max(200),
        description: z.string().min(1).max(10_000),
        tags: z.array(z.string().max(100)).max(20).optional(),
      }),
      response: myFeedbackResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const feedback = await this.loadMyFeedback(params.feedbackId, user.id);
      if (feedback.status !== "pending") {
        throw new BadRequestError("Only pending feedback can be edited");
      }

      await this.feedback.updateById(feedback.id, {
        title: body.title.slice(0, 200),
        description: body.description.slice(0, 10_000),
        tags: (body.tags ?? []).slice(0, 20),
      });

      const updated = await this.feedbackWith.findById(feedback.id, {
        include: FeedbackController.withRelationsAndProject,
      });
      const [resource] = await this.toMyResources([
        updated as MyFeedbackWithRelations,
      ]);
      return resource;
    },
  });

  /**
   * Soft-delete one of the caller's OWN feedback. Allowed only while
   * `pending`; reporter-only (404 otherwise).
   */
  deleteMyFeedback = $action({
    use: [$secure()],
    method: "DELETE",
    path: "/me/feedback/:feedbackId",
    schema: {
      params: z.object({ feedbackId: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const feedback = await this.loadMyFeedback(params.feedbackId, user.id);
      if (feedback.status !== "pending") {
        throw new BadRequestError("Only pending feedback can be deleted");
      }
      await this.feedback.deleteById(feedback.id);
      return { ok: true };
    },
  });

  /**
   * Owner guard. Delegates to `ProjectSecurityService.assertOwner` and returns
   * the resolved project for handlers that need it.
   */
  protected async ensureOwner(projectId: number, user: UserAccountToken) {
    return await this.security.assertOwner(projectId, user);
  }

  /**
   * Member guard. Delegates to `ProjectSecurityService.assertMember` for the
   * read endpoints (list/detail) that any project member may access.
   */
  protected async ensureMember(projectId: number, user: UserAccountToken) {
    return await this.security.assertMember(projectId, user);
  }

  /**
   * Load the target project and reject when the feedback module is off.
   * Used by submit + attachment-upload — the only two endpoints
   * non-members can reach, so they need their own opt-in gate.
   */
  protected async assertFeedbackOpen(projectId: number) {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    if (!project) {
      throw new NotFoundError("Project not found");
    }
    if (!project.features?.feedback) {
      throw new ForbiddenError("This project is not accepting feedback");
    }
    return project;
  }

  /**
   * Load a feedback row by id, asserting it belongs to the expected
   * project.
   */
  protected async loadFeedback(
    projectId: number,
    feedbackId: number,
  ): Promise<FeedbackWithRelations> {
    const feedback = await this.feedbackWith.findOne({
      where: {
        id: { eq: feedbackId },
        projectId: { eq: projectId },
      },
      include: FeedbackController.withRelations,
    });
    if (!feedback) {
      throw new NotFoundError("Feedback not found");
    }
    return feedback;
  }

  /**
   * Resolve reporter, attachment metadata, and linked-quest stubs for a batch
   * of feedback. Single round-trip per related table to avoid N+1.
   */
  protected async toResources(
    rows: FeedbackWithRelations[],
  ): Promise<FeedbackResource[]> {
    if (rows.length === 0) return [];

    // Attachments are a `uuid[]` column, not a foreign key, so this one stays
    // a lookup: there is no relation to declare over a JSON array. The
    // reporter and the linked quests arrived with the row.
    const fileIds = [...new Set(rows.flatMap((p) => p.attachments ?? []))];
    const fileEntities =
      fileIds.length > 0
        ? await this.fileRepo.findMany({ where: { id: { inArray: fileIds } } })
        : [];
    const fileById = new Map(fileEntities.map((f) => [f.id, f]));

    return rows.map((p) => {
      const reporter = p.reporter;
      const attachmentUrls = (p.attachments ?? []).flatMap((id) => {
        const f = fileById.get(id);
        if (!f) return [];
        return [
          {
            id: f.id,
            name: f.name,
            url: `/api/files/${f.id}`,
            mimeType: f.mimeType,
            size: f.size,
          },
        ];
      });
      const linked = (p.linkedQuests ?? []).map((q) => ({
        id: q.id,
        shortId: q.shortId,
        title: q.title,
        status: q.completedAt
          ? ("completed" as const)
          : q.acceptedAt
            ? ("accepted" as const)
            : ("new" as const),
        priority: q.priority,
        area: q.area,
        acceptedAt: q.acceptedAt ?? undefined,
        completedAt: q.completedAt ?? undefined,
      }));
      return {
        ...p,
        reporter: reporter
          ? {
              id: reporter.id,
              username: reporter.username ?? undefined,
              name:
                [reporter.firstName, reporter.lastName]
                  .filter((s): s is string => !!s?.trim())
                  .join(" ")
                  .trim() || undefined,
              picture: reporter.picture ?? undefined,
            }
          : undefined,
        attachmentUrls,
        linkedQuests: linked,
      };
    });
  }

  /**
   * Load a feedback row owned by the caller (its reporter). Returns 404 —
   * not 403 — when the row is missing OR belongs to someone else, so a
   * reporter can never probe for another user's feedback ids.
   */
  protected async loadMyFeedback(
    feedbackId: number,
    userId: string,
  ): Promise<Feedback> {
    const feedback = await this.feedback.findOne({
      where: { id: { eq: feedbackId } },
    });
    if (!feedback || feedback.reporterUserId !== userId) {
      throw new NotFoundError("Feedback not found");
    }
    return feedback;
  }

  /**
   * Like {@link toResources} but joins each feedback row's owning project
   * (title + icon) — for the reporter's cross-project `/me` list.
   */
  protected async toMyResources(
    rows: MyFeedbackWithRelations[],
  ): Promise<MyFeedbackResource[]> {
    if (rows.length === 0) return [];

    // `toResources` maps positionally, so index i still names row i.
    const base = await this.toResources(rows);

    return base.map((resource, i) => {
      const c = rows[i]?.project;
      return {
        ...resource,
        project: c
          ? { id: c.id, title: c.title, icon: c.icon ?? null }
          : { id: resource.projectId, title: "—", icon: null },
      };
    });
  }

  /**
   * Verify every claimed attachment was uploaded by the same user. Prevents a
   * caller from referencing another user's files in their feedback.
   */
  protected async assertAttachmentsBelongToUser(
    ids: string[],
    userId: string,
  ): Promise<void> {
    const found = await this.fileRepo.findMany({
      where: {
        id: { inArray: ids },
        creator: { eq: userId },
        bucket: { eq: FeedbackRateLimiter.ATTACHMENT_BUCKET },
      },
    });
    if (found.length !== ids.length) {
      throw new HttpError({
        status: 400,
        message: "One or more attachments are invalid",
      });
    }
  }

  protected extractExtension(name: string): string | undefined {
    const idx = name.lastIndexOf(".");
    if (idx < 0 || idx === name.length - 1) return undefined;
    return name.slice(idx + 1).toLowerCase();
  }
}
