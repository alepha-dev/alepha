import { $inject, Alepha } from "alepha";

import { pinnedContentAtom } from "../../api/atoms/pinnedContentAtom.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";
import { ResourceRegistry } from "../../api/resources/ResourceRegistry.ts";
import { PinnedFolioFolder } from "../../api/services/PinnedFolioFolder.ts";
import { ProjectContextRegistry } from "./ProjectContextRegistry.ts";

/**
 * Knowledge's section of `project_context`: the folio index and the pinned
 * folios, registered on core's `ProjectContextRegistry` (#E75, #Q2623).
 */
export class KnowledgeProjectContext {
  /**
   * Folio index cap. Sized so a project with 30 folios fits well under the
   * ~2K token orientation budget; beyond it the index would crowd out the
   * quest signal. Agents follow the `capped` flag and drill via `folio_list`
   * when they need the long tail.
   */
  public static readonly FOLIO_INDEX_CAP = 30;

  protected readonly alepha = $inject(Alepha);
  protected readonly registry = $inject(ProjectContextRegistry);
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly folioController = $inject(FolioController);
  protected readonly pinnedFolder = $inject(PinnedFolioFolder);

  constructor() {
    this.registry.register({
      key: "knowledge.folios",
      order: 30,
      capability: "knowledge",
      context: ({ projectId }) => this.folios(projectId),
    });
  }

  protected async folios(projectId: number): Promise<Record<string, unknown>> {
    const cap = KnowledgeProjectContext.FOLIO_INDEX_CAP;
    // Fetch one over the cap to detect truncation without a separate count
    // query: cheap on D1 (single LIKE-free indexed range scan).
    const folios = await this.folioController.list({
      query: { projectId, limit: cap + 1 },
    });
    const capped = folios.length > cap;
    const shown = capped ? folios.slice(0, cap) : folios;

    // The epic a folio is filed under, by number: through the `epic` kind
    // Work registers, read once for the page. Absent without Work.
    const epicIds = [
      ...new Set(
        shown.flatMap((folio) => (folio.epicId != null ? [folio.epicId] : [])),
      ),
    ];
    const epicNumberById = new Map(
      (
        await this.resources.describe("epic", projectId, epicIds.map(String))
      ).map((ref) => [Number(ref.id), ref.shortId]),
    );
    const items = shown.map((folio) => ({
      shortId: folio.shortId,
      title: folio.title,
      updatedAt: folio.updatedAt,
      // Omit when empty so agents seeing the field always trust it. The
      // schema field is optional; consumers fall back to title.
      summary: folio.summary?.trim() ? folio.summary : undefined,
      epicNumber:
        folio.epicId != null ? epicNumberById.get(folio.epicId) : undefined,
    }));

    // Pinned-folio content surface (the per-project CLAUDE.md). Drop
    // protected folios: their content is ciphertext and useless to the agent.
    // Cap logic lives in `PinnedFolioFolder` so it can be unit-tested without
    // spinning the MCP transport.
    const { pinnedFolios, pinnedFoliosTruncated } = this.pinnedFolder.fold(
      folios
        .filter((f) => f.pinned && !f.protected)
        // The controller already sorts (pinned DESC, updatedAt DESC), so
        // this slice is already newest-first.
        .map((f) => ({
          id: f.id,
          shortId: f.shortId,
          title: f.title,
          content: f.content,
        })),
      this.alepha.store.get(pinnedContentAtom).maxChars,
    );

    return {
      folios: { shown: items.length, capped, items },
      pinnedFolios,
      pinnedFoliosTruncated,
    };
  }
}
