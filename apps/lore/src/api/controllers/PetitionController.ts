import { $inject, t } from "alepha";
import { FileService, files } from "alepha/api/files";
import { users } from "alepha/api/users";
import { $bucket } from "alepha/bucket";
import { $logger } from "alepha/logger";
import { $repository, $sequence, $transactional } from "alepha/orm";
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
import { campaigns } from "../entities/campaigns.ts";
import { type Petition, petitions } from "../entities/petitions.ts";
import { quests } from "../entities/quests.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import {
  type PetitionResource,
  petitionResourceSchema,
} from "../schemas/petitionResourceSchema.ts";
import { petitionSourceSchema } from "../schemas/petitionSourceSchema.ts";
import { PetitionRateLimiter } from "../services/PetitionRateLimiter.ts";

const petitionBodySchema = t.object({
  title: t.string({ minLength: 1, maxLength: 200 }),
  description: t.string({ minLength: 1, maxLength: 10_000 }),
  attachments: t.optional(t.array(t.uuid())),
  tags: t.optional(t.array(t.string({ maxLength: 100 }), { maxItems: 20 })),
  /**
   * Provenance of an embedded submission. Absent for first-party petitions.
   * The fields are attacker-controlled (set by the embedding page) — they
   * are persisted verbatim and must only ever be rendered as escaped plain
   * text. See `petitions.source` + folio #12.
   */
  source: t.optional(petitionSourceSchema),
});

/**
 * Petition endpoints. All endpoints require authentication — there is no
 * anonymous / embed-token path. External "report a bug" links are expected to
 * be plain `<a href="/c/:id/request?path=...">` anchors that drop the user on
 * the in-app request form after a one-tap Google login.
 */
export class PetitionController {
  protected log = $logger();
  protected petitions = $repository(petitions);
  protected campaigns = $repository(campaigns);
  protected quests = $repository(quests);
  protected users = $repository(users);
  protected fileRepo = $repository(files);
  protected rateLimiter = $inject(PetitionRateLimiter);
  protected security = $inject(AppSecurityProvider);
  protected fileService = $inject(FileService);
  protected fileSystem = $inject(FileSystemProvider);

  /**
   * Per-campaign sequence for `petitions.shortId`. Used in MCP responses and
   * UI display so reporters can reference "petition #5 in Lore".
   */
  protected petitionShortId = $sequence();

  /**
   * Bucket for petition attachments. Size cap mirrors `petitionOptionsAtom`
   * — the bucket-level limit acts as a hard backstop in case the controller
   * check is bypassed. MIME whitelist is enforced at upload time (not here)
   * so it can read from the atom rather than baking values into `$bucket`.
   */
  attachmentBucket = $bucket({
    name: PetitionRateLimiter.ATTACHMENT_BUCKET,
    maxSize: 5,
  });

  /**
   * Submit a petition for a campaign. Any logged-in Lore user can submit so
   * long as the target campaign has the petition module enabled
   * (`features.petitions === true`). Membership is NOT required — petitions
   * are explicitly the "outside-the-team feedback channel". The petition
   * module toggle is the campaign owner's only opt-in/out lever.
   */
  submitPetition = $action({
    use: [$secure(), $transactional()],
    method: "POST",
    path: "/campaigns/:campaignId/petitions",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      body: petitionBodySchema,
      response: t.object({ id: t.integer() }),
    },
    handler: async ({ params, body, user }) => {
      await this.assertPetitionsOpen(params.campaignId);

      await this.rateLimiter.assertPetitionAllowed(user.id);

      const limits = this.rateLimiter.options();
      const attachments = body.attachments ?? [];
      if (attachments.length > limits.maxAttachmentsPerPetition) {
        throw new BadRequestError(
          `Too many attachments (max ${limits.maxAttachmentsPerPetition})`,
        );
      }

      if (attachments.length > 0) {
        await this.assertAttachmentsBelongToUser(attachments, user.id);
      }

      const shortId = await this.petitionShortId.next(
        String(params.campaignId),
      );

      const created = await this.petitions.create({
        campaignId: params.campaignId,
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
   * Minimal public campaign info for the petition request page. The page is
   * a top-level route (not under the `campaign` layout) so it has no campaign
   * data — and it must work for non-members. Gated EXACTLY like
   * `submitPetition`: any logged-in user, but only when the campaign has the
   * petition module on. Returns just the title + icon needed to render the
   * "you're submitting to X" header — nothing else.
   */
  petitionContext = $action({
    use: [$secure()],
    method: "GET",
    path: "/campaigns/:campaignId/petitions/context",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      response: t.object({
        title: t.string(),
        icon: t.optional(t.union([t.uuid(), t.null()])),
      }),
    },
    handler: async ({ params }) => {
      const campaign = await this.assertPetitionsOpen(params.campaignId);
      return { title: campaign.title, icon: campaign.icon ?? null };
    },
  });

  /**
   * Upload a single attachment for a future petition. Returns a file id that
   * the client passes back in `submit.body.attachments`. Per-user daily upload
   * rate limit applies. MIME + extension are both checked against the
   * `petitionOptionsAtom` whitelist.
   */
  uploadPetitionAttachment = $action({
    use: [$secure()],
    method: "POST",
    path: "/campaigns/:campaignId/petitions/attachments",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      body: t.object({
        file: t.file(),
      }),
      response: t.object({
        id: t.uuid(),
        name: t.string(),
        size: t.number(),
        mimeType: t.string(),
      }),
    },
    handler: async ({ params, body, user }) => {
      await this.assertPetitionsOpen(params.campaignId);
      await this.rateLimiter.assertAttachmentAllowed(user.id);

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

      const stored = await this.fileService.uploadFile(reusable, {
        bucket: this.attachmentBucket.name,
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
   * List petitions for a campaign, filtered by status. Readable by any
   * campaign member; triage (accept/reject/remove) stays owner-only.
   */
  listPetitions = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/campaigns/:campaignId/petitions",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      query: t.object({
        status: t.optional(
          t.enum(["pending", "accepted", "rejected", "all"], { mode: "text" }),
        ),
      }),
      response: t.object({ items: t.array(petitionResourceSchema) }),
    },
    handler: async ({ params, query, user }) => {
      await this.ensureMember(params.campaignId, user);

      const status = query.status ?? "pending";
      const where = this.petitions.createQueryWhere();
      where.campaignId = { eq: params.campaignId };
      if (status !== "all") {
        where.status = { eq: status };
      }

      const items = await this.petitions.findMany({
        where,
        orderBy: [{ column: "createdAt", direction: "desc" }],
      });

      return { items: await this.toResources(items) };
    },
  });

  /**
   * Fetch a single petition by id, scoped to its campaign. Readable by
   * any campaign member.
   */
  getPetition = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/campaigns/:campaignId/petitions/:petitionId",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        petitionId: t.integer(),
      }),
      response: petitionResourceSchema,
    },
    handler: async ({ params, user }) => {
      await this.ensureMember(params.campaignId, user);
      const petition = await this.loadPetition(
        params.campaignId,
        params.petitionId,
      );
      const [resource] = await this.toResources([petition]);
      return resource;
    },
  });

  /**
   * Accept a petition — owner declares the request valid. Status flips
   * `pending → accepted`; quests are created separately via the regular
   * `createQuest` flow, passing `petitionId` so the spawned work links back
   * to this petition. A single petition can spawn many quests.
   *
   * Owner-only.
   */
  acceptPetition = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/campaigns/:campaignId/petitions/:petitionId/accept",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        petitionId: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.ensureOwner(params.campaignId, user);
      const petition = await this.loadPetition(
        params.campaignId,
        params.petitionId,
      );

      if (petition.status !== "pending") {
        throw new BadRequestError("Petition already triaged");
      }

      await this.petitions.updateById(petition.id, { status: "accepted" });
      return { ok: true };
    },
  });

  /**
   * Reporter-facing view: returns a petition the user submitted, including
   * the quests it spawned and their current statuses. Reporters can see
   * progression without being campaign members — this is how an external
   * submitter follows up on their report.
   *
   * Authorized when the caller is the petition's reporter OR the campaign
   * owner; everyone else gets 404 (never 403 — avoids leaking petition
   * existence to outsiders).
   */
  getMyPetition = $action({
    use: [$secure()],
    method: "GET",
    path: "/campaigns/:campaignId/petitions/:petitionId/mine",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        petitionId: t.integer(),
      }),
      response: petitionResourceSchema,
    },
    handler: async ({ params, user }) => {
      const petition = await this.loadPetition(
        params.campaignId,
        params.petitionId,
      );

      const campaign = await this.campaigns.findById(params.campaignId);
      const isOwner = campaign?.createdBy === user.id;
      const isReporter = petition.reporterUserId === user.id;

      if (!isReporter && !isOwner) {
        throw new NotFoundError("Petition not found");
      }

      const [resource] = await this.toResources([petition]);
      return resource;
    },
  });

  /**
   * Reject a petition — soft state transition, the row remains for audit.
   * Owner-only.
   */
  rejectPetition = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/campaigns/:campaignId/petitions/:petitionId/reject",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        petitionId: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.ensureOwner(params.campaignId, user);
      const petition = await this.loadPetition(
        params.campaignId,
        params.petitionId,
      );

      await this.petitions.updateById(petition.id, { status: "rejected" });
      return { ok: true };
    },
  });

  /**
   * Soft-delete a petition row. Owner-only.
   */
  removePetition = $action({
    use: [$secure({ permissions: ["campaign:delete"] })],
    method: "DELETE",
    path: "/campaigns/:campaignId/petitions/:petitionId",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        petitionId: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.ensureOwner(params.campaignId, user);
      const petition = await this.loadPetition(
        params.campaignId,
        params.petitionId,
      );
      await this.petitions.deleteById(petition.id);
      return { ok: true };
    },
  });

  /**
   * Owner guard. Delegates to `AppSecurityProvider.assertOwner` and returns
   * the resolved campaign for handlers that need it.
   */
  protected async ensureOwner(campaignId: number, user: UserAccountToken) {
    return await this.security.assertOwner(campaignId, user);
  }

  /**
   * Member guard. Delegates to `AppSecurityProvider.assertMember` for the
   * read endpoints (list/detail) that any campaign member may access.
   */
  protected async ensureMember(campaignId: number, user: UserAccountToken) {
    return await this.security.assertMember(campaignId, user);
  }

  /**
   * Load the target campaign and reject when the petition module is off.
   * Used by submit + attachment-upload — the only two endpoints
   * non-members can reach, so they need their own opt-in gate.
   */
  protected async assertPetitionsOpen(campaignId: number) {
    const campaign = await this.campaigns.findOne({
      where: { id: { eq: campaignId } },
    });
    if (!campaign) {
      throw new NotFoundError("Campaign not found");
    }
    if (!campaign.features?.petitions) {
      throw new ForbiddenError("This campaign is not accepting petitions");
    }
    return campaign;
  }

  /**
   * Load a petition by id, asserting it belongs to the expected campaign.
   */
  protected async loadPetition(
    campaignId: number,
    petitionId: number,
  ): Promise<Petition> {
    const petition = await this.petitions.findOne({
      where: {
        id: { eq: petitionId },
        campaignId: { eq: campaignId },
      },
    });
    if (!petition) {
      throw new NotFoundError("Petition not found");
    }
    return petition;
  }

  /**
   * Resolve reporter, attachment metadata, and linked-quest stubs for a batch
   * of petitions. Single round-trip per related table to avoid N+1.
   */
  protected async toResources(rows: Petition[]): Promise<PetitionResource[]> {
    if (rows.length === 0) return [];

    const userIds = [
      ...new Set(
        rows
          .map((p) => p.reporterUserId)
          .filter((id): id is string => id != null),
      ),
    ];
    const fileIds = [...new Set(rows.flatMap((p) => p.attachments ?? []))];
    const petitionIds = rows.map((p) => p.id);

    const [reporters, fileEntities, linkedQuests] = await Promise.all([
      userIds.length > 0
        ? this.users.findMany({ where: { id: { inArray: userIds } } })
        : Promise.resolve([]),
      fileIds.length > 0
        ? this.fileRepo.findMany({ where: { id: { inArray: fileIds } } })
        : Promise.resolve([]),
      this.quests.findMany({
        where: { petitionId: { inArray: petitionIds } },
        orderBy: [{ column: "createdAt", direction: "asc" }],
      }),
    ]);

    const reporterById = new Map(reporters.map((u) => [u.id, u]));
    const fileById = new Map(fileEntities.map((f) => [f.id, f]));
    const questsByPetition = new Map<number, typeof linkedQuests>();
    for (const q of linkedQuests) {
      if (q.petitionId == null) continue;
      const list = questsByPetition.get(q.petitionId) ?? [];
      list.push(q);
      questsByPetition.set(q.petitionId, list);
    }

    return rows.map((p) => {
      const reporter = p.reporterUserId
        ? reporterById.get(p.reporterUserId)
        : undefined;
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
      const linked = (questsByPetition.get(p.id) ?? []).map((q) => ({
        id: q.id,
        shortId: q.shortId,
        title: q.title,
        status: q.completedAt
          ? ("completed" as const)
          : q.acceptedAt
            ? ("accepted" as const)
            : ("new" as const),
        difficulty: q.difficulty,
        priority: q.priority,
        zone: q.zone,
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
   * Verify every claimed attachment was uploaded by the same user. Prevents a
   * caller from referencing another user's files in their petition.
   */
  protected async assertAttachmentsBelongToUser(
    ids: string[],
    userId: string,
  ): Promise<void> {
    const found = await this.fileRepo.findMany({
      where: {
        id: { inArray: ids },
        creator: { eq: userId },
        bucket: { eq: PetitionRateLimiter.ATTACHMENT_BUCKET },
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
