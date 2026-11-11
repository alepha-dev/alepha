import {
  ProjectCapabilityGuards,
  ProjectDeletionService,
} from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { ConflictError } from "alepha/server";

import { estates } from "../entities/estates.ts";

/**
 * A project that is the home of an estate is not deleted and does not lose
 * Apps (#Q3280, epic #E126): refused, naming the estates, until they are moved
 * or deleted. Never a cascade (folio #1194, rule 1): other projects may
 * deploy onto those estates, and cascading would break them in silence.
 *
 * Both refusals are guards core runs before anything is written: the
 * deletion one before the project's slug is freed and before any deletion
 * step, for the owner's delete, the admin's and the admin's bulk delete; the
 * capability one before the capability row is deleted.
 *
 * `estates.projectId` is `restrict`, and never fires on a project's soft
 * delete: this guard is what keeps a soft-deleted project from being the home
 * of a live estate. Nothing injects this; it registers itself.
 */
export class DeployEstateHomeGuards {
  protected readonly estates = $repository(estates);
  protected readonly deletion = $inject(ProjectDeletionService);
  protected readonly capabilities = $inject(ProjectCapabilityGuards);

  /**
   * How many estates a refusal names before it counts the rest.
   */
  protected readonly nameLimit = 5;

  constructor() {
    this.deletion.registerGuard({
      name: "deploy",
      check: async (projectId) => {
        const named = await this.homedIn(projectId);
        if (named) {
          throw new ConflictError(
            `This project is the home of ${named}. Move or delete them first: other projects may deploy onto them.`,
          );
        }
      },
    });
    this.capabilities.register({
      key: "apps",
      name: "deploy",
      check: async (projectId) => {
        const named = await this.homedIn(projectId);
        if (named) {
          throw new ConflictError(
            `This project is the home of ${named}, which only Apps can manage. Move or delete them before turning Apps off.`,
          );
        }
      },
    });
  }

  /**
   * The estates a project is the home of, as a phrase, or undefined.
   */
  protected async homedIn(projectId: number): Promise<string | undefined> {
    const rows = await this.estates.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["slug"],
      orderBy: [{ column: "slug", direction: "asc" }],
    });
    if (rows.length === 0) {
      return undefined;
    }
    const slugs = rows.map((row) => row.slug);
    const rest = slugs.length - this.nameLimit;
    return `${slugs.length === 1 ? "the estate" : "the estates"} ${slugs
      .slice(0, this.nameLimit)
      .join(", ")}${rest > 0 ? ` and ${rest} more` : ""}`;
  }
}
