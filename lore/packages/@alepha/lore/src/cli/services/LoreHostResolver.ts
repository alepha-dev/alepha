import type { HostController, ProjectHostController } from "@lore/ship/api";
import { $inject } from "alepha";
import { UsageError } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "./LoreClientService.ts";

/**
 * Finds a host by slug for a `lore host` verb (#Q3131, #Q3282).
 *
 * A slug is unique inside a home project, not per person (epic #E126). So:
 *
 * - a **managing** verb (`update`, `rotate`, `delete`, `move`) resolves the
 *   slug among the hosts the project IS THE HOME OF, and never acts on
 *   one it only borrows;
 * - a **reading** verb (`get`, `wait`, `stats`) and `lend` resolve among the
 *   hosts the caller can read, narrowed to the project's own and the ones
 *   it borrows when there is a project; two with one slug are refused,
 *   naming each with its home project, and `--home <project>` picks one.
 *   Never a silent choice (#Q3144).
 */
export class LoreHostResolver {
  protected readonly client = $inject(LoreClientService);
  protected readonly hosts = $client<HostController>(this.client.scope());
  protected readonly lending = $client<ProjectHostController>(
    this.client.scope(),
  );

  /**
   * The host named `slug` that the project is the home of.
   */
  async managed(slug: string, projectId: number, project: string) {
    const { items } = await this.lending.listHomeHosts({
      params: { projectId },
    });
    const host = items.find((item) => item.slug === slug);
    if (!host) {
      throw new UsageError(
        `${project} is the home of no host named ${slug}. A managing verb never acts on a host the project only borrows: lore host list shows which ones it can use, and from which project.`,
      );
    }
    return host;
  }

  /**
   * The host named `slug` among those the caller can read, narrowed to
   * the project's when one is given, with `home` to choose between two.
   */
  async readable(
    slug: string,
    options: { projectId?: number; home?: string; need?: string } = {},
  ) {
    const { items } = await this.hosts.listMyHosts();
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
        `No host named ${slug} that you can ${options.need === "host:lend" ? "lend" : "read"}${options.home ? ` in ${options.home}` : ""}. lore host list shows the project's.`,
      );
    }
    if (candidates.length > 1) {
      throw new UsageError(
        `Several hosts are named ${slug}: ${candidates
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
