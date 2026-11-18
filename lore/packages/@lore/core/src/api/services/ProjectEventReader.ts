import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";

import { projectEvents } from "../entities/projectEvents.ts";
import type { ProjectEventListQuery } from "../schemas/projectEventListQuerySchema.ts";
import type { ProjectEventPage } from "../schemas/projectEventPageSchema.ts";
import { ProjectEventCatalog } from "./ProjectEventCatalog.ts";
import { ProjectRecipients } from "./ProjectRecipients.ts";

/**
 * A project's recent events (#Q3895), newest first, bounded and paginated.
 * A caller sees an event only when they hold its read permission from the
 * catalog, the same rule delivery applies.
 */
export class ProjectEventReader {
  protected readonly events = $repository(projectEvents);
  protected readonly catalog = $inject(ProjectEventCatalog);
  protected readonly recipients = $inject(ProjectRecipients);

  public async list(
    projectId: number,
    user: UserAccountToken,
    query: ProjectEventListQuery = {},
  ): Promise<ProjectEventPage> {
    const held = await this.recipients.of(projectId, user);
    const readable = this.catalog
      .all()
      .filter((event) => held.includes(event.permission))
      .map((event) => event.name)
      .filter((name) => !query.name || name === query.name);
    if (!readable.length) return { items: [], hasMore: false };
    const limit = query.limit ?? 20;
    const rows = await this.events.findMany({
      where: {
        projectId,
        name: { inArray: readable },
        ...(query.subject ? { subjectId: query.subject } : {}),
      },
      orderBy: [{ column: "occurredAt", direction: "desc" }],
      limit: limit + 1,
      offset: query.offset ?? 0,
    });
    return {
      items: rows.slice(0, limit).map((row) => ({
        id: row.id,
        name: row.name,
        subjectKind: row.subjectKind,
        ...(row.subjectId ? { subjectId: row.subjectId } : {}),
        fields: row.fields,
        occurredAt: row.occurredAt,
      })),
      hasMore: rows.length > limit,
    };
  }
}
