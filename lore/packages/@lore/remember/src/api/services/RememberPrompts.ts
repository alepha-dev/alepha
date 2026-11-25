import { type PromptArgContext, PromptRegistry } from "@lore/core/api";
import { formatReference } from "@lore/core/web";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { folios } from "../entities/folios.ts";

/**
 * The folio arg of the prompts registry (#Q4343): what fills a prompt's
 * `{{folio.*}}`, read by the folio's number, and the folios its select
 * lists. Registered here because Remember owns folios; Requirements'
 * `import-specification` is the built-in that takes one.
 */
export class RememberPrompts {
  protected readonly registry = $inject(PromptRegistry);
  protected readonly folios = $repository(folios);

  constructor() {
    this.registry.registerArg({
      type: "folio",
      permission: "folio:read",
      resolve: (context) => this.folioOf(context),
    });
    this.registry.registerOptions("folio", (projectId) =>
      this.folioOptions(projectId),
    );
  }

  /**
   * The digits of `12`, `#12`, `#F12`.
   */
  protected numberOf(value: string): number | undefined {
    const match = /^#?[A-Za-z]?(\d{1,9})$/.exec(value.trim());
    return match ? Number(match[1]) : undefined;
  }

  protected async folioOf(context: PromptArgContext) {
    const number = this.numberOf(context.value);
    if (number === undefined) return undefined;
    const folio = await this.folios.findOne({
      where: {
        projectId: { eq: context.project.id },
        shortId: { eq: number },
      },
    });
    if (!folio) return undefined;
    return {
      gone: !!folio.deletedAt,
      fields: {
        reference: formatReference("folio", folio.shortId),
        title: folio.title,
        url: `${context.projectUrl}/folios/${folio.shortId}`,
        number: folio.shortId,
        id: folio.id,
      },
    };
  }

  /**
   * The newest folios, never a deleted one.
   */
  protected async folioOptions(projectId: number) {
    const rows = await this.folios.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["shortId", "title", "deletedAt"],
      orderBy: [{ column: "shortId", direction: "desc" }],
      limit: 200,
    });
    return rows
      .filter((it) => !it.deletedAt)
      .map((it) => ({
        value: String(it.shortId),
        label: `${formatReference("folio", it.shortId)} ${it.title}`,
      }));
  }
}
