import { $ownsProject, ProjectSecurityService } from "@lore/core/api";
import type { CapabilityKey } from "@lore/core/schemas";
import { CapabilityRegistry } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { docsCorpus } from "./docs/docsCorpus.ts";
import type { DocsSection } from "./docs/LoreDocsCorpusBuilder.ts";

/**
 * How-to answers from Lore's own guides (#Q3212): `searchDocs`, offered to
 * the assistant as an `$action`. It has no reason to be an MCP tool: an
 * outside agent reads the docs site directly.
 *
 * The corpus is `lore/docs/1-guides`, by `##` section, generated into
 * `docs/docsCorpus.ts`. A section of a guide whose capability is off in the
 * project is never returned: filtered by capability, not by rank, since a
 * guide is not written per rank. Every URL points at the docs site, so the
 * model can link only a page the tool returned.
 */
export class LoreAiDocsController {
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly capabilities = $inject(CapabilityRegistry);

  /**
   * The sections searched, swapped by a spec.
   */
  protected corpus: DocsSection[] = docsCorpus;

  public readonly searchDocs = $action({
    method: "GET",
    path: "/assistant/projects/:projectId/docs",
    group: "ai",
    description:
      "Search Lore's own guides for how to do something or where something is: the sections that match, each with its URL on the docs site. Answer how-to questions from these sections only, and link only the URLs returned here.",
    use: [$ownsProject({ requires: "project:read", param: "projectId" })],
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        q: z.text({ minLength: 1, maxLength: 200 }),
        limit: z.integer().min(1).max(8).optional(),
      }),
      response: z.object({
        sections: z.array(
          z.object({
            guide: z.text(),
            section: z.text(),
            url: z.text(),
            text: z.text({ size: "rich" }),
          }),
        ),
      }),
    },
    handler: async ({ params, query }) => {
      const enabled = Object.keys(
        await this.security.capabilitiesOf(params.projectId),
      ) as CapabilityKey[];
      const terms = this.termsOf(query.q);
      const scored = this.corpus
        .filter((section) =>
          this.capabilities.isOwnerEnabled(section.capability, enabled),
        )
        .map((section) => ({ section, score: this.score(section, terms) }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, query.limit ?? 4);
      return {
        sections: scored.map(({ section }) => ({
          guide: section.guide,
          section: section.section,
          url: section.url,
          text: section.text,
        })),
      };
    },
  });

  /**
   * The words of a query worth matching: lower case, three letters or more.
   */
  protected termsOf(query: string): string[] {
    return [
      ...new Set(
        query
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((term) => term.length >= 3),
      ),
    ];
  }

  /**
   * A heading or guide-title hit weighs more than a body hit.
   */
  protected score(section: DocsSection, terms: string[]): number {
    const title = `${section.guide} ${section.section}`.toLowerCase();
    const body = section.text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 3;
      if (body.includes(term)) score += 1;
    }
    return score;
  }
}
