import type {
  EstateController,
  ProjectEstateController,
} from "@lore/deploy/api";
import { $inject } from "alepha";
import { UsageError } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "./LoreClientService.ts";

/**
 * Finds an estate by slug for a `lore estate` verb (#Q3131, #Q3282).
 *
 * A slug is unique inside a home project, not per person (epic #E126). So:
 *
 * - a **managing** verb (`update`, `rotate`, `delete`, `move`) resolves the
 *   slug among the estates the project IS THE HOME OF, and never acts on
 *   one it only borrows;
 * - a **reading** verb (`get`, `wait`, `stats`) and `lend` resolve among the
 *   estates the caller can read, narrowed to the project's own and the ones
 *   it borrows when there is a project; two with one slug are refused,
 *   naming each with its home project, and `--home <project>` picks one.
 *   Never a silent choice (#Q3144).
 */
export class LoreEstateResolver {
  protected readonly client = $inject(LoreClientService);
  protected readonly estates = $client<EstateController>(this.client.scope());
  protected readonly lending = $client<ProjectEstateController>(
    this.client.scope(),
  );

  /**
   * The estate named `slug` that the project is the home of.
   */
  async managed(slug: string, projectId: number, project: string) {
    const { items } = await this.lending.listHomeEstates({
      params: { projectId },
    });
    const estate = items.find((item) => item.slug === slug);
    if (!estate) {
      throw new UsageError(
        `${project} is the home of no estate named ${slug}. A managing verb never acts on an estate the project only borrows: lore estate list shows which ones it can use, and from which project.`,
      );
    }
    return estate;
  }

  /**
   * The estate named `slug` among those the caller can read, narrowed to
   * the project's when one is given, with `home` to choose between two.
   */
  async readable(
    slug: string,
    options: { projectId?: number; home?: string; need?: string } = {},
  ) {
    const { items } = await this.estates.listMyEstates();
    const named = items.filter(
      (item) =>
        item.slug === slug &&
        (!options.need || item.can.includes(options.need)),
    );
    const inProject =
      options.projectId === undefined
        ? named
        : named.filter(
            (item) =>
              item.project?.id === options.projectId ||
              item.projects.some((loan) => loan.id === options.projectId),
          );
    let candidates = inProject.length ? inProject : named;
    if (options.home) {
      const home = options.home.toLowerCase();
      candidates = candidates.filter(
        (item) =>
          item.project?.slug?.toLowerCase() === home ||
          item.project?.title.toLowerCase() === home ||
          String(item.project?.id) === options.home,
      );
    }
    if (candidates.length === 0) {
      throw new UsageError(
        `No estate named ${slug} that you can ${options.need === "estate:lend" ? "lend" : "read"}${options.home ? ` in ${options.home}` : ""}. lore estate list shows the project's.`,
      );
    }
    if (candidates.length > 1) {
      throw new UsageError(
        `Several estates are named ${slug}: ${candidates
          .map(
            (item) =>
              `${slug} of ${item.project?.slug ?? item.project?.title ?? "no project"}`,
          )
          .join(", ")}. Choose one with --home <project>.`,
      );
    }
    return candidates[0]!;
  }
}
