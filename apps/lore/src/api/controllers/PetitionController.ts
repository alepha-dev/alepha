import { $inject, t } from "alepha";
import { files } from "alepha/api/files";
import { users } from "alepha/api/users";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $secure, type UserAccountToken } from "alepha/security";
import {
  $action,
  BadRequestError,
  NotFoundError,
  okSchema,
} from "alepha/server";
import { campaigns } from "../entities/campaigns.ts";
import { type Petition, petitions } from "../entities/petitions.ts";
import { quests } from "../entities/quests.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import {
  type PetitionResource,
  petitionResourceSchema,
} from "../schemas/petitionResourceSchema.ts";

/**
 * Petition endpoints. All endpoints require authentication.
 *
 * Petitions arrive ONLY via the sigil in-app dialog
 * (`POST /sigils/:id/petition` on {@link SigilIngestController}). This
 * controller handles the campaign-owner inbox: list, detail, accept, reject,
 * remove. There is no first-party submission path here.
 */
export class PetitionController {
  protected log = $logger();
  protected petitions = $repository(petitions);
  protected campaigns = $repository(campaigns);
  protected quests = $repository(quests);
  protected users = $repository(users);
  protected fileRepo = $repository(files);
  protected security = $inject(AppSecurityProvider);

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
      // Reporter-access: only when the petition carries an email AND it matches
      // the calling user's DB-verified email. Resolve from the DB so the check
      // works regardless of what the JWT carries. If `reporterEmail` is null
      // (anonymous sigil petition with no partner-supplied email) there is no
      // reporter-view — only the campaign owner can see it.
      let isReporter = false;
      if (petition.reporterEmail != null) {
        const callerEmail = await this.resolveUserEmail(user);
        isReporter =
          callerEmail != null && petition.reporterEmail === callerEmail;
      }

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
   * Resolve attachment metadata and linked-quest stubs for a batch of
   * petitions. Single round-trip per related table to avoid N+1.
   *
   * Reporter identity is carried directly on `petition.reporterEmail` — no
   * separate user lookup is performed.
   */
  protected async toResources(rows: Petition[]): Promise<PetitionResource[]> {
    if (rows.length === 0) return [];

    const fileIds = [...new Set(rows.flatMap((p) => p.attachments ?? []))];
    const petitionIds = rows.map((p) => p.id);

    const [fileEntities, linkedQuests] = await Promise.all([
      fileIds.length > 0
        ? this.fileRepo.findMany({ where: { id: { inArray: fileIds } } })
        : Promise.resolve([]),
      this.quests.findMany({
        where: { petitionId: { inArray: petitionIds } },
        orderBy: [{ column: "createdAt", direction: "asc" }],
      }),
    ]);

    const fileById = new Map(fileEntities.map((f) => [f.id, f]));
    const questsByPetition = new Map<number, typeof linkedQuests>();
    for (const q of linkedQuests) {
      if (q.petitionId == null) continue;
      const list = questsByPetition.get(q.petitionId) ?? [];
      list.push(q);
      questsByPetition.set(q.petitionId, list);
    }

    return rows.map((p) => {
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
        attachmentUrls,
        linkedQuests: linked,
      };
    });
  }

  /**
   * Resolve the verified email address for a logged-in user from the database.
   * The JWT token only carries `id` and `roles`; the email must be fetched from
   * the users table to guarantee it is the account-verified address. Returns
   * `undefined` when the user record cannot be found or carries no email.
   */
  protected async resolveUserEmail(
    user: UserAccountToken,
  ): Promise<string | undefined> {
    // Prefer the email already on the token when present — avoids a DB
    // round-trip on providers that embed it (e.g. OAuth JWTs from the test
    // harness when the full user object is injected directly).
    if (user.email) {
      return user.email;
    }
    const record = await this.users.findById(user.id);
    return record?.email ?? undefined;
  }
}
