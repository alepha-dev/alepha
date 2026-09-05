import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { projects } from "../entities/projects.ts";
import { referenceConversionReportSchema } from "../schemas/referenceConversionReportSchema.ts";
import { FolioLinkService } from "../services/FolioLinkService.ts";
import { ReferenceConversionService } from "../services/ReferenceConversionService.ts";

/**
 * The operator's door to the one-shot reference converter of epic #32.
 *
 * An admin action rather than an MCP tool, because MCP resolves projects
 * through membership and cannot reach a project the operator is not in,
 * and Lore is public; and rather than a local script, because the resolver
 * needs the project's lookup tables and the protected-folio skip in process.
 * Gated on `admin:reference:convert`, the `admin:<thing>:<verb>` shape the
 * other admin controllers use.
 *
 * Dry run by default. The write is the one-way door of the epic: after the
 * purge nothing can resolve `[[Some Folio Title]]` again, so the report of
 * a dry run is read against production before the write, and a D1 Time
 * Travel bookmark is taken first. This controller is deleted by the purge
 * (quest #1808) once the conversion has run.
 */
export class AdminReferenceController {
  protected readonly projects = $repository(projects);
  protected readonly conversion = $inject(ReferenceConversionService);
  protected readonly links = $inject(FolioLinkService);

  public readonly convertReferences = $action({
    method: "POST",
    path: "/admin/references/convert",
    group: "admin:references",
    use: [$secure({ permissions: ["admin:reference:convert"] })],
    description:
      "Rewrite every stored wiki-link to the typed #Q12 grammar, in every project, or in one. Dry run unless told otherwise.",
    schema: {
      body: z.object({
        /**
         * `true` (the default) computes and reports; `false` writes.
         */
        dryRun: z.boolean().optional(),
        /**
         * One project instead of all of them, for a rehearsal.
         */
        projectId: z.integer().optional(),
      }),
      response: referenceConversionReportSchema,
    },
    handler: async ({ body, user }) => {
      const dryRun = body.dryRun ?? true;
      const ids =
        body.projectId != null
          ? [body.projectId]
          : (
              await this.projects.findMany({
                columns: ["id"],
                orderBy: [{ column: "id", direction: "asc" }],
              })
            ).map((p) => p.id);

      // Counted before the run: rewriting a body re-syncs its links from the
      // new text, which already drops the blob rows that body produced, so a
      // count taken afterwards would only ever see the leftovers.
      const blobLinks = await this.links.countLinksTo("blob");

      const reports = [];
      for (const projectId of ids) {
        reports.push(
          await this.conversion.convertProject(projectId, {
            dryRun,
            byUserId: user.id,
          }),
        );
      }

      // Whatever blob rows the re-syncs left (a body the converter did not
      // rewrite) go last, and only on a write. The purge (quest #1808)
      // removes the `blob` literal from the enum, and a stored value the
      // enum no longer has fails validation on read, so the rows must be
      // gone before it.
      if (!dryRun) await this.links.deleteLinksTo("blob");

      return { dryRun, blobLinks, projects: reports };
    },
  });
}
