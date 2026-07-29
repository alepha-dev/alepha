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
import { type Campaign, campaigns } from "../entities/campaigns.ts";
import { type Petition, petitions } from "../entities/petitions.ts";
import type { Quest } from "../entities/quests.ts";
import type { User } from "../entities/users.ts";
import { relations } from "../relations.ts";
import {
  type MyPetitionResource,
  myPetitionResourceSchema,
} from "../schemas/myPetitionResourceSchema.ts";
import {
  type PetitionResource,
  petitionResourceSchema,
} from "../schemas/petitionResourceSchema.ts";
import { petitionSourceSchema } from "../schemas/petitionSourceSchema.ts";
import { CampaignSecurityService } from "../services/CampaignSecurityService.ts";
import { PetitionRateLimiter } from "../services/PetitionRateLimiter.ts";

const petitionBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  attachments: z.array(z.uuid()).optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  /**
   * Provenance of an embedded submission. Absent for first-party petitions.
   * The fields are attacker-controlled (set by the embedding page) — they
   * are persisted verbatim and must only ever be rendered as escaped plain
   * text. See `petitions.source` + folio #12.
   */
  source: petitionSourceSchema.optional(),
});

/**
 * A petition carrying the rows a resource needs, as `include` returns them.
 *
 * Written out rather than inferred so the mappers below state their input
 * instead of inheriting it from whichever call site was edited last.
 */
type PetitionWithRelations = Petition & {
  reporter?: User;
  linkedQuests: Array<Quest>;
};

type MyPetitionWithRelations = PetitionWithRelations & {
  campaign?: Campaign;
};

/**
 * Petition endpoints. All endpoints require authentication — there is no
 * anonymous / embed-token path. External "report a bug" links are expected to
 * be plain `<a href="/c/:id/request?path=...">` anchors that drop the user on
 * the in-app request form after a one-tap Google login.
 */
export class PetitionController {
  protected log = $logger();
  protected petitions = $repository(petitions);
  /**
   * The same table, with `include`. Reads that need a petition's reporter,
   * campaign or linked quests go through this one, so the join happens in the
   * statement instead of in three follow-up queries and three Maps.
   */
  protected petitionsWith = $repository(relations, "petitions");
  protected campaigns = $repository(campaigns);
  protected fileRepo = $repository(files);

  /**
   * What every petition read needs alongside the row itself. Declared once so
   * the four entry points cannot drift apart -- they all feed the same mapper.
   */
  protected static readonly withRelations = {
    reporter: true,
    linkedQuests: { orderBy: { column: "createdAt", direction: "asc" } },
  } as const;

  /** ...plus the owning campaign, for the reporter's cross-campaign list. */
  protected static readonly withRelationsAndCampaign = {
    ...PetitionController.withRelations,
    campaign: true,
  } as const;

  protected rateLimiter = $inject(PetitionRateLimiter);
  protected security = $inject(CampaignSecurityService);
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
   * so it can read from the atom rather than baking values into `$storage`.
   */
  attachmentBucket = $storage({
    name: PetitionRateLimiter.ATTACHMENT_BUCKET,
    maxSize: 5,
  });

  /**
   * Submit a petition for a campaign. Any logged-in Lore user can submit so
   * long as the target campaign has the petition module enabled
   * (`features.petitions === true`). Membership is NOT required — petitions
   * are explicitly the "outside-the-team feedback channel". The petition
   * module toggle is the campaign owner's only opt-in/out lever.
   *
   * The per-user daily rate limit applies only to NON-members: owners and
   * members belong to the campaign and submit without limit. Exceeding the
   * limit yields a 429 (whose message survives to the client), not a 500.
   */
  submitPetition = $action({
    use: [$secure(), $transactional()],
    method: "POST",
    path: "/campaigns/:campaignId/petitions",
    schema: {
      params: z.object({ campaignId: z.integer() }),
      body: petitionBodySchema,
      response: z.object({ id: z.integer() }),
    },
    handler: async ({ params, body, user }) => {
      await this.assertPetitionsOpen(params.campaignId);

      // The petition rate limit only throttles outsiders — petitions are the
      // "outside-the-team feedback channel". Campaign owners/members belong to
      // the campaign and submit without limit.
      if (!(await this.security.isMember(params.campaignId, user))) {
        await this.rateLimiter.assertPetitionAllowed(user.id);
      }

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
      params: z.object({ campaignId: z.integer() }),
      response: z.object({
        title: z.string(),
        icon: z.union([z.uuid(), z.null()]).optional(),
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
      params: z.object({ campaignId: z.integer() }),
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
      await this.assertPetitionsOpen(params.campaignId);
      // Members are exempt from the upload throttle too (same rationale as
      // submitPetition) — the limit is an outsider control.
      if (!(await this.security.isMember(params.campaignId, user))) {
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
   * List petitions for a campaign, filtered by status. Readable by any
   * campaign member; triage (accept/reject/remove) stays owner-only.
   */
  listPetitions = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/campaigns/:campaignId/petitions",
    schema: {
      params: z.object({ campaignId: z.integer() }),
      query: z.object({
        status: z
          .enum(["pending", "accepted", "rejected", "all"])
          .meta({ mode: "text" })
          .optional(),
      }),
      response: z.object({ items: z.array(petitionResourceSchema) }),
    },
    handler: async ({ params, query, user }) => {
      await this.ensureMember(params.campaignId, user);

      const status = query.status ?? "pending";
      const where = this.petitions.createQueryWhere();
      where.campaignId = { eq: params.campaignId };
      if (status !== "all") {
        where.status = { eq: status };
      }

      const items = await this.petitionsWith.findMany({
        where,
        orderBy: [{ column: "createdAt", direction: "desc" }],
        include: PetitionController.withRelations,
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
      params: z.object({
        campaignId: z.integer(),
        petitionId: z.integer(),
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
   * Read a single petition attachment's bytes (base64) plus its metadata.
   * Campaign-member gated, with an IDOR guard: the `attachmentId` must be one
   * of the petition's own `attachments`. Backs the `petition_attachment_get`
   * MCP tool, which wraps the bytes into an MCP `image` content block so an
   * agent can actually see the screenshot. The 5 MB upload cap bounds the
   * base64 payload (~6.7 MB).
   */
  getPetitionAttachment = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/campaigns/:campaignId/petitions/:petitionId/attachments/:attachmentId",
    schema: {
      params: z.object({
        campaignId: z.integer(),
        petitionId: z.integer(),
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
      await this.ensureMember(params.campaignId, user);
      const petition = await this.loadPetition(
        params.campaignId,
        params.petitionId,
      );

      // IDOR guard: only attachments that belong to THIS petition are
      // readable — a member can't read an arbitrary file id this way.
      if (!(petition.attachments ?? []).includes(params.attachmentId)) {
        throw new NotFoundError("Attachment not found on this petition");
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
      params: z.object({
        campaignId: z.integer(),
        petitionId: z.integer(),
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
   * Reject a petition — soft state transition, the row remains for audit.
   * Owner-only.
   */
  rejectPetition = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/campaigns/:campaignId/petitions/:petitionId/reject",
    schema: {
      params: z.object({
        campaignId: z.integer(),
        petitionId: z.integer(),
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
      params: z.object({
        campaignId: z.integer(),
        petitionId: z.integer(),
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
   * Reporter-facing list of the caller's OWN petitions across every campaign
   * they submitted to (the `/me` profile page). Paginated for `AlephaTable`,
   * with optional search / status / campaign filters. No membership needed —
   * a petition belongs to its reporter regardless of campaign membership.
   */
  listMyPetitions = $action({
    use: [$secure()],
    method: "GET",
    path: "/me/petitions",
    schema: {
      query: pageQuerySchema.extend({
        search: z.string().optional(),
        status: z
          .enum(["pending", "accepted", "rejected", "all"])
          .meta({ mode: "text" })
          .optional(),
        campaignId: z.integer().optional(),
      }),
      response: db.page(myPetitionResourceSchema),
    },
    handler: async ({ query, user }) => {
      const where = this.petitions.createQueryWhere();
      where.reporterUserId = { eq: user.id };

      if (query.search) {
        where.title = { ilike: `%${query.search}%` };
      }
      if (query.status && query.status !== "all") {
        where.status = { eq: query.status };
      }
      if (query.campaignId) {
        where.campaignId = { eq: query.campaignId };
      }

      query.sort ??= "-createdAt";

      const result = await this.petitionsWith.paginate(
        query,
        { where, include: PetitionController.withRelationsAndCampaign },
        { count: true },
      );

      return {
        ...result,
        content: await this.toMyResources(result.content),
      };
    },
  });

  /**
   * The distinct campaigns the caller has petitions in — drives the campaign
   * filter dropdown on the `/me` petitions page. A reporter may have petitioned
   * campaigns they are not a member of, so this can't be derived from the
   * user's own campaign list.
   */
  listMyPetitionCampaigns = $action({
    use: [$secure()],
    method: "GET",
    path: "/me/petition-campaigns",
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
      const rows = await this.petitions.findMany({
        where: { reporterUserId: { eq: user.id } },
        columns: ["campaignId"],
      });
      const ids = [...new Set(rows.map((r) => r.campaignId))];
      if (ids.length === 0) return { items: [] };

      const camps = await this.campaigns.findMany({
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
   * Edit one of the caller's OWN petitions. Allowed only while the petition is
   * still `pending` — once the owner triages it (accepted → quest, or
   * rejected) it is locked. Reporter-only: a petition the caller didn't submit
   * 404s (never 403 — avoids leaking existence).
   */
  updateMyPetition = $action({
    use: [$secure()],
    method: "POST",
    path: "/me/petitions/:petitionId",
    schema: {
      params: z.object({ petitionId: z.integer() }),
      body: z.object({
        title: z.string().min(1).max(200),
        description: z.string().min(1).max(10_000),
        tags: z.array(z.string().max(100)).max(20).optional(),
      }),
      response: myPetitionResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const petition = await this.loadMyPetition(params.petitionId, user.id);
      if (petition.status !== "pending") {
        throw new BadRequestError("Only pending petitions can be edited");
      }

      await this.petitions.updateById(petition.id, {
        title: body.title.slice(0, 200),
        description: body.description.slice(0, 10_000),
        tags: (body.tags ?? []).slice(0, 20),
      });

      const updated = await this.petitionsWith.findById(petition.id, {
        include: PetitionController.withRelationsAndCampaign,
      });
      const [resource] = await this.toMyResources([
        updated as MyPetitionWithRelations,
      ]);
      return resource;
    },
  });

  /**
   * Soft-delete one of the caller's OWN petitions. Allowed only while
   * `pending`; reporter-only (404 otherwise).
   */
  deleteMyPetition = $action({
    use: [$secure()],
    method: "DELETE",
    path: "/me/petitions/:petitionId",
    schema: {
      params: z.object({ petitionId: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const petition = await this.loadMyPetition(params.petitionId, user.id);
      if (petition.status !== "pending") {
        throw new BadRequestError("Only pending petitions can be deleted");
      }
      await this.petitions.deleteById(petition.id);
      return { ok: true };
    },
  });

  /**
   * Owner guard. Delegates to `CampaignSecurityService.assertOwner` and returns
   * the resolved campaign for handlers that need it.
   */
  protected async ensureOwner(campaignId: number, user: UserAccountToken) {
    return await this.security.assertOwner(campaignId, user);
  }

  /**
   * Member guard. Delegates to `CampaignSecurityService.assertMember` for the
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
  ): Promise<PetitionWithRelations> {
    const petition = await this.petitionsWith.findOne({
      where: {
        id: { eq: petitionId },
        campaignId: { eq: campaignId },
      },
      include: PetitionController.withRelations,
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
  protected async toResources(
    rows: PetitionWithRelations[],
  ): Promise<PetitionResource[]> {
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
   * Load a petition owned by the caller (its reporter). Returns 404 — not 403
   * — when the petition is missing OR belongs to someone else, so a reporter
   * can never probe for another user's petition ids.
   */
  protected async loadMyPetition(
    petitionId: number,
    userId: string,
  ): Promise<Petition> {
    const petition = await this.petitions.findOne({
      where: { id: { eq: petitionId } },
    });
    if (!petition || petition.reporterUserId !== userId) {
      throw new NotFoundError("Petition not found");
    }
    return petition;
  }

  /**
   * Like {@link toResources} but joins each petition's owning campaign (title +
   * icon) — for the reporter's cross-campaign `/me` list.
   */
  protected async toMyResources(
    rows: MyPetitionWithRelations[],
  ): Promise<MyPetitionResource[]> {
    if (rows.length === 0) return [];

    // `toResources` maps positionally, so index i still names row i.
    const base = await this.toResources(rows);

    return base.map((resource, i) => {
      const c = rows[i]?.campaign;
      return {
        ...resource,
        campaign: c
          ? { id: c.id, title: c.title, icon: c.icon ?? null }
          : { id: resource.campaignId, title: "—", icon: null },
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
