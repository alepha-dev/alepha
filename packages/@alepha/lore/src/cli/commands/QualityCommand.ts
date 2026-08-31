import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { $client } from "alepha/server/links";
import type { ProjectController } from "lore/api/controllers/ProjectController";
import type { QualityController } from "lore/api/controllers/QualityController";

import { GitContextService } from "../services/GitContextService.ts";
import { LoreClientService } from "../services/LoreClientService.ts";
import { QualityReportReader } from "../services/QualityReportReader.ts";

/**
 * `alepha lore quality push` - the command that closes the loop.
 *
 * ```bash
 * alepha test --coverage
 * export LORE_API_KEY=...
 * alepha lore quality push --project alepha
 * ```
 *
 * ## ⚠️ The controller types are TYPES, and must stay ones
 *
 * Both imports above are `import type`, so they are fully erased: nothing from
 * Lore's server graph is registered, loaded, or bundled. What they buy is that
 * the two calls below are checked against the endpoints that will answer them,
 * end to end, with no hand-maintained wire contract to drift.
 *
 * They must **never** reach an exported signature of `@alepha/lore/cli`. This
 * class is deliberately not re-exported from `index.ts`, and
 * `scripts/check-dts.mjs` fails the build if any emitted `.d.ts` names the
 * private `lore` workspace: a published package that declares a dependency on
 * a workspace nobody outside this repo can resolve breaks for whoever installs
 * the tarball, not for us.
 *
 * ## Failing loudly is the design
 *
 * A push that cannot happen exits non-zero, and there is no opt-out flag in
 * v1. The safety is where the command runs rather than in a flag: the push
 * step is `continue-on-error` and skipped on pull requests, so a red push is a
 * warning annotation that blocks no deploy and reddens no fork PR. A `--soft`
 * flag can be added the day a second caller needs one.
 */
export class QualityCommand {
  protected readonly log = $logger();
  protected readonly client = $inject(LoreClientService);
  protected readonly reader = $inject(QualityReportReader);
  protected readonly git = $inject(GitContextService);

  /**
   * ⚠️ Declared after `client`, and it has to be: a field initializer reading
   * another field sees `undefined` if that field is declared below it.
   *
   * The scope resolves the hostname now and the credential per request, which
   * is what lets this class be constructed on a machine holding no key at all
   * - `--help` has to work there.
   */
  protected readonly api = $client<QualityController>(this.client.scope());
  protected readonly projects = $client<ProjectController>(this.client.scope());

  public readonly push = $command({
    name: "push",
    description:
      "Push the coverage and test totals of the last run into a Lore project",
    flags: z.object({
      project: z
        .text({
          description:
            "Lore project slug, overriding the one in alepha.config.ts for this invocation",
        })
        .optional(),
    }),
    handler: async ({ flags, root }) => {
      const project = this.client.resolveProject(flags.project);
      const report = await this.reader.read(root);
      const [projectId, git] = await Promise.all([
        this.resolveProjectId(project),
        this.git.resolve(root),
      ]);

      await this.api.pushQualityRun({
        params: { projectId },
        body: {
          commitSha: git.commitSha,
          branch: git.branch,
          coverage: report.coverage,
          tests: report.tests,
          durationMs: report.durationMs,
        },
      });

      this.log.info(
        `Pushed ${report.tests.total} test(s) and ${report.coverage.lines}% line coverage to ${project}`,
        { commitSha: git.commitSha, branch: git.branch },
      );
    },
  });

  public readonly quality = $command({
    name: "quality",
    description: "Coverage and test totals",
    children: [this.push],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly lore = $command({
    name: "lore",
    description: "Talk to a Lore instance",
    children: [this.quality],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * `--project` names a project the way a person does: by its slug, which is
   * what Lore's own URLs carry. Every project-scoped endpoint takes an integer
   * id, so one of the two has to translate.
   *
   * It happens here rather than on the endpoint because `$ownsProject` gates
   * by primary key from a path param, and a slug is not the key -
   * `getProjectBySlug` has to check membership by hand for exactly that
   * reason. Pushing the translation into the endpoint would mean a second gate
   * shape in Lore for the benefit of one caller.
   *
   * A numeric value is taken as an id directly, so a caller that already has
   * one pays no round trip.
   */
  protected async resolveProjectId(project: string): Promise<number> {
    if (/^\d+$/.test(project)) {
      return Number(project);
    }

    const found = await this.projects.getProjectBySlug({
      params: { slug: project },
    });
    if (!found?.id) {
      throw new AlephaError(
        `No Lore project named "${project}". Check the slug in its URL, or pass --project <slug>.`,
      );
    }
    return found.id;
  }
}
