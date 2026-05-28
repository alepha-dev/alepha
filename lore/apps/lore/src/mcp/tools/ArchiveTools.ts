import { $inject, t } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { BlobController } from "../../api/controllers/BlobController.ts";
import { CampaignController } from "../../api/controllers/CampaignController.ts";
import { DirectoryController } from "../../api/controllers/DirectoryController.ts";

/**
 * MCP tools for the Archive module (quest #66). Folio tools stay in
 * `FolioTools` — the Archive surface adds `directory_*` and `blob_*`
 * tools for the per-campaign tree of folios + directories + blobs.
 */
export class ArchiveTools {
  protected readonly directoryController = $inject(DirectoryController);
  protected readonly blobController = $inject(BlobController);
  protected readonly campaignController = $inject(CampaignController);

  protected async resolveCampaignId(
    campaign?: number,
    campaign_name?: string,
  ): Promise<number> {
    const campaigns = await this.campaignController.getMyCampaigns();
    if (campaign) {
      const found = campaigns.find((p) => p.id === campaign);
      if (!found) throw new NotFoundError(`Campaign ${campaign} not found`);
      return found.id;
    }
    if (campaign_name) {
      const found = campaigns.find(
        (p) => p.title.toLowerCase() === campaign_name.toLowerCase(),
      );
      if (!found)
        throw new NotFoundError(`Campaign "${campaign_name}" not found`);
      return found.id;
    }
    throw new BadRequestError(
      "Campaign is required. Specify `campaign` or `campaign_name`.",
    );
  }

  protected async resolveDirectoryId(
    campaignId: number,
    shortId: number | undefined,
  ): Promise<string | undefined> {
    if (shortId === undefined) return undefined;
    const directory = await this.directoryController.getDirectoryByShortId({
      params: { campaignId, shortId },
    });
    return directory.id;
  }

  protected async resolveBlobFileId(
    campaignId: number,
    shortId: number,
  ): Promise<string> {
    const blob = await this.blobController.getBlobByShortId({
      params: { campaignId, shortId },
    });
    return blob.id;
  }

  // ---------------------------------------------------------------------------
  // directory_* tools
  // ---------------------------------------------------------------------------

  directory_list = $tool({
    description:
      "List the contents of an archive directory (folios + blobs + child directories) in one call. Pass `directory_shortId` to drill in, or omit for the campaign root. Returns the directory metadata, the breadcrumb (root → … → parent), and `entries` tagged by `kind`. This is the Drive-like browse endpoint for AI agents.",
    title: "List archive directory contents",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: t.object({
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
        directory_shortId: t.optional(t.integer()),
      }),
      result: t.object({
        directory_shortId: t.optional(t.integer()),
        breadcrumb: t.array(
          t.object({ shortId: t.integer(), name: t.string() }),
        ),
        entries: t.array(
          t.object({
            kind: t.enum(["directory", "folio", "blob"]),
            shortId: t.integer(),
            name: t.string(),
            updatedAt: t.string(),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const parentId = await this.resolveDirectoryId(
        campaignId,
        params.directory_shortId,
      );
      const result = await this.directoryController.listContents({
        params: { campaignId },
        query: { parentId },
      });
      return {
        directory_shortId: result.directory?.shortId,
        breadcrumb: result.breadcrumb.map((b) => ({
          shortId: b.shortId,
          name: b.name,
        })),
        entries: result.entries.map((e) => ({
          kind: e.kind,
          shortId: e.shortId,
          name: e.name,
          updatedAt: e.updatedAt,
        })),
      };
    },
  });

  directory_create = $tool({
    description:
      "Create a new archive directory. Drive-style auto-suffix on name collision (`name (1)`, `name (2)`, ...).",
    title: "Create archive directory",
    annotations: { destructiveHint: false },
    schema: {
      params: t.object({
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
        name: t.string({ minLength: 1, maxLength: 200 }),
        parent_shortId: t.optional(t.integer()),
      }),
      result: t.object({
        id: t.uuid(),
        shortId: t.integer(),
        name: t.string(),
      }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const parentId = await this.resolveDirectoryId(
        campaignId,
        params.parent_shortId,
      );
      const created = await this.directoryController.createDirectory({
        params: { campaignId },
        body: { name: params.name, parentId },
      });
      return {
        id: created.id,
        shortId: created.shortId,
        name: created.name,
      };
    },
  });

  directory_rename = $tool({
    description: "Rename an archive directory (auto-suffix on collision).",
    title: "Rename archive directory",
    annotations: { idempotentHint: true, destructiveHint: false },
    schema: {
      params: t.object({
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
        directory_shortId: t.integer(),
        name: t.string({ minLength: 1, maxLength: 200 }),
      }),
      result: t.object({ shortId: t.integer(), name: t.string() }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const id = await this.resolveDirectoryId(
        campaignId,
        params.directory_shortId,
      );
      if (!id) throw new NotFoundError("Directory not found");
      const updated = await this.directoryController.renameDirectory({
        params: { id },
        body: { name: params.name },
      });
      return { shortId: updated.shortId, name: updated.name };
    },
  });

  directory_move = $tool({
    description:
      "Move an archive directory under a new parent (or to the campaign root). Refuses to create cycles.",
    title: "Move archive directory",
    annotations: { idempotentHint: true, destructiveHint: false },
    schema: {
      params: t.object({
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
        directory_shortId: t.integer(),
        new_parent_shortId: t.optional(t.integer()),
      }),
      result: t.object({ shortId: t.integer(), name: t.string() }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const id = await this.resolveDirectoryId(
        campaignId,
        params.directory_shortId,
      );
      if (!id) throw new NotFoundError("Directory not found");
      const parentId = await this.resolveDirectoryId(
        campaignId,
        params.new_parent_shortId,
      );
      const updated = await this.directoryController.moveDirectory({
        params: { id },
        body: { parentId },
      });
      return { shortId: updated.shortId, name: updated.name };
    },
  });

  directory_delete = $tool({
    description:
      "Delete an archive directory. Refuses if not empty unless `cascade: true` — cascade recursively wipes the subtree (folios + blobs + sub-directories) via the DB cascade.",
    title: "Delete archive directory",
    annotations: { destructiveHint: true },
    schema: {
      params: t.object({
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
        directory_shortId: t.integer(),
        cascade: t.optional(t.boolean()),
      }),
      result: t.object({ ok: t.boolean() }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const id = await this.resolveDirectoryId(
        campaignId,
        params.directory_shortId,
      );
      if (!id) throw new NotFoundError("Directory not found");
      await this.directoryController.deleteDirectory({
        params: { id },
        query: { cascade: params.cascade },
      });
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------------------
  // blob_* tools
  //
  // Blob *uploads* are out of MCP scope for v1 — agents can't post bytes
  // efficiently through the JSON-RPC channel. The list / rename / move /
  // delete tools are the meaningful surface: agents inspect what
  // humans uploaded, organize it, and embed it inline via the markdown
  // embed syntax (`![alt](blob:#N)` — quest #67).
  // ---------------------------------------------------------------------------

  blob_list = $tool({
    description:
      "List archive blobs in a campaign (or a single directory). Each entry includes shortId, name, size, mimeType, and the optional sha256 + originalName.",
    title: "List archive blobs",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: t.object({
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
        directory_shortId: t.optional(t.integer()),
      }),
      result: t.object({
        blobs: t.array(
          t.object({
            shortId: t.integer(),
            name: t.string(),
            size: t.number(),
            mimeType: t.string(),
            sha256: t.optional(t.string()),
            originalName: t.optional(t.string()),
            updatedAt: t.string(),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const directoryId = await this.resolveDirectoryId(
        campaignId,
        params.directory_shortId,
      );
      const blobs = await this.blobController.listBlobs({
        params: { campaignId },
        query: { directoryId },
      });
      return {
        blobs: blobs.map((b) => ({
          shortId: b.shortId,
          name: b.name,
          size: b.size,
          mimeType: b.mimeType,
          sha256: b.sha256,
          originalName: b.originalName,
          updatedAt: b.updatedAt,
        })),
      };
    },
  });

  blob_rename = $tool({
    description: "Rename an archive blob (auto-suffix on collision).",
    title: "Rename archive blob",
    annotations: { idempotentHint: true, destructiveHint: false },
    schema: {
      params: t.object({
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
        blob_shortId: t.integer(),
        name: t.string({ minLength: 1, maxLength: 200 }),
      }),
      result: t.object({ shortId: t.integer(), name: t.string() }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const fileId = await this.resolveBlobFileId(
        campaignId,
        params.blob_shortId,
      );
      const updated = await this.blobController.renameBlob({
        params: { id: fileId },
        body: { name: params.name },
      });
      return { shortId: updated.shortId, name: updated.name };
    },
  });

  blob_move = $tool({
    description: "Move an archive blob to a different directory.",
    title: "Move archive blob",
    annotations: { idempotentHint: true, destructiveHint: false },
    schema: {
      params: t.object({
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
        blob_shortId: t.integer(),
        new_directory_shortId: t.optional(t.integer()),
      }),
      result: t.object({ shortId: t.integer(), name: t.string() }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const fileId = await this.resolveBlobFileId(
        campaignId,
        params.blob_shortId,
      );
      const directoryId = await this.resolveDirectoryId(
        campaignId,
        params.new_directory_shortId,
      );
      const updated = await this.blobController.moveBlob({
        params: { id: fileId },
        body: { directoryId },
      });
      return { shortId: updated.shortId, name: updated.name };
    },
  });

  blob_delete = $tool({
    description: "Delete an archive blob and reclaim its storage.",
    title: "Delete archive blob",
    annotations: { destructiveHint: true },
    schema: {
      params: t.object({
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
        blob_shortId: t.integer(),
      }),
      result: t.object({ ok: t.boolean() }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const fileId = await this.resolveBlobFileId(
        campaignId,
        params.blob_shortId,
      );
      await this.blobController.deleteBlob({ params: { id: fileId } });
      return { ok: true };
    },
  });

  // (resolveBlobFileId hoisted up alongside resolveDirectoryId — both
  // delegate to a public controller endpoint, no reach-into-private-state.)
}
