import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import {
  type DashboardCardValue,
  DashboardMetricCatalog,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";

import { folioRevisions } from "../entities/folioRevisions.ts";
import { type Folio, folios } from "../entities/folios.ts";

/**
 * The last edited folios, with who edited them and when (#Q2658): the
 * project's knowledge moving. "Who" is the latest revision's author.
 */
export class RecentFoliosMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "recentFolios";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly folios = $repository(folios);
  protected readonly revisions = $repository(folioRevisions);
  protected readonly users = $repository(users);

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();
    for (const entry of cards) {
      const project = entry.scope.projects[0];
      if (!project) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const slug = project.slug ?? "";
      const recent = await this.folios.findMany({
        where: { projectId: { eq: project.id } },
        orderBy: [{ column: "updatedAt", direction: "desc" }],
        limit: 8,
      });
      if (recent.length === 0) {
        out.set(entry.card.id, { empty: "noFolio", detail: {} });
        continue;
      }
      const revisions = await this.revisions.findMany({
        where: { folioId: { inArray: recent.map((folio) => folio.id) } },
        orderBy: [{ column: "at", direction: "desc" }],
        limit: 80,
      });
      const authorOf = new Map<string, string>();
      for (const revision of revisions) {
        if (!authorOf.has(revision.folioId) && revision.byUserId) {
          authorOf.set(revision.folioId, revision.byUserId);
        }
      }
      const ids = [...new Set(authorOf.values())];
      const people = ids.length
        ? await this.users.findMany({ where: { id: { inArray: ids } } })
        : [];
      const nameOf = new Map(
        people.map((person) => [
          person.id,
          [person.firstName, person.lastName].filter(Boolean).join(" ") ||
            person.username ||
            "",
        ]),
      );
      out.set(entry.card.id, {
        value: recent.length,
        rows: recent.map((folio) => ({
          ...this.row(folio, slug),
          at: folio.updatedAt,
          excerpt: nameOf.get(authorOf.get(folio.id) ?? "") || undefined,
        })),
        detail: {},
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: slug,
        }),
      });
    }
    return out;
  }

  /**
   * A folio as a row: its typed reference and title, linked to it.
   */
  protected row(
    folio: Folio,
    projectSlug: string,
  ): NonNullable<DashboardCardValue["rows"]>[number] {
    return {
      id: `F${folio.shortId}`,
      title: folio.title,
      link: {
        route: "projectFoliosFolio",
        params: { projectSlug, shortId: String(folio.shortId) },
      },
    };
  }
}
