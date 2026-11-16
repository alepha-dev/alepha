import { BestEffort } from "@lore/core/api";
import { folios } from "@lore/remember/schemas";
import { $hook, $inject } from "alepha";
import { $repository } from "alepha/orm";

import { requirements } from "../entities/requirements.ts";
import { SourceSectionService } from "./SourceSectionService.ts";

/**
 * Source changed (#E153, #Q3769): on each new revision of a folio, every
 * requirement citing a section of it compares that section with the text it
 * was synced to, and flags itself when the section was edited or removed.
 *
 * Remember emits `folio:revision:created` and never imports this package;
 * a failure here never fails the folio save.
 */
export class RequirementSourceWatcher {
  protected readonly requirements = $repository(requirements);
  protected readonly folios = $repository(folios);
  protected readonly sections = $inject(SourceSectionService);
  protected readonly bestEffort = $inject(BestEffort);

  protected readonly onRevision = $hook({
    on: "folio:revision:created",
    handler: async ({ folioId, revisionId }) => {
      await this.bestEffort.run("requirement source watch", () =>
        this.check(folioId, revisionId),
      );
    },
  });

  /**
   * Compare every requirement citing `folioId` with the folio's body now.
   */
  public async check(folioId: string, revisionId: string): Promise<void> {
    const citing = await this.requirements.findMany({
      where: { sourceFolioId: { eq: folioId } },
    });
    const watched = citing.filter(
      (it) => it.sourceAnchor && it.sourceSectionText !== undefined,
    );
    if (watched.length === 0) return;
    const folio = await this.folios.findById(folioId);
    // A protected folio's body is ciphertext the server cannot read.
    if (!folio || folio.protected) return;
    for (const requirement of watched) {
      const change = this.sections.compare(
        requirement.sourceSectionText ?? "",
        folio.content ?? "",
        requirement.sourceAnchor!,
      );
      const flagged = change !== "unchanged";
      if (
        flagged === !!requirement.sourceChanged &&
        (!flagged || requirement.sourceChangeKind === change)
      ) {
        continue;
      }
      await this.requirements.updateById(requirement.id, {
        sourceChanged: flagged,
        sourceChangeKind: flagged ? change : (null as never),
        sourceChangedRevisionId: flagged ? revisionId : (null as never),
      });
    }
  }
}
