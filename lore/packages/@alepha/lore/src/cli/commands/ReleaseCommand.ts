import { $inject, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { $client } from "alepha/server/links";
import type { ReleaseController } from "lore/api/controllers/ReleaseController";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `alepha lore releases publish` - flip the Lore release that carries a
 * version tag to published, from the job that just shipped that version.
 *
 * ```bash
 * export LORE_API_KEY=...
 * alepha lore releases publish --tag 0.28.0
 * ```
 *
 * ## ⚠️ Not found and already published both exit 0, on purpose
 *
 * `quality push` and `artifacts push` fail loudly, and their JSDoc says so:
 * a build that cannot be reported is a build fact worth a red step. Whether a
 * Lore release carries the version tag is a PLANNING fact. A release job that
 * goes red because nobody created a Lore release for this version blocks
 * nothing useful and reads as a failed release, so the missing release is a
 * log line and a clean exit. The already-published case is what makes a
 * re-run of the job safe.
 *
 * Everything else still fails loudly: a wrong key, a project the key cannot
 * see, a release the key may not publish. Those are configuration facts, and
 * silence there would hide a job that has stopped doing its work.
 *
 * ## Why the release is found client-side
 *
 * There is no get-by-tag endpoint on `ReleaseController`. `ReleaseTools` in
 * Lore's MCP already lists the project's releases and finds the tag in
 * memory, and this does the same rather than adding a second lookup shape to
 * the server for one caller. Case-sensitive, because `releaseTagSchema`
 * preserves case so a tag can match `artifacts.tag` byte for byte.
 *
 * ## ⚠️ The controller type is a TYPE, and must stay one
 *
 * `import type`, so it is erased: nothing from Lore's server graph is loaded.
 * It must never reach an exported signature of `@alepha/lore/cli`; this class
 * is deliberately not re-exported from `index.ts`, and `scripts/check-dts.ts`
 * fails the build if an emitted `.d.ts` names the private `lore` workspace.
 */
export class ReleaseCommand {
  protected readonly log = $logger();
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);

  /**
   * ⚠️ Declared after `client`, and it has to be: a field initializer reading
   * another field sees `undefined` if that field is declared below it.
   *
   * The scope resolves the hostname now and the credential per request, which
   * is what lets this class be constructed on a machine holding no key at all:
   * `--help` has to work there.
   */
  protected readonly api = $client<ReleaseController>(this.client.scope());

  public readonly publish = $command({
    name: "publish",
    description:
      "Publish the Lore release carrying a version tag, when there is one",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description:
            "Lore project slug, overriding LORE_PROJECT for this invocation",
        })
        .optional(),
      tag: z.text({
        aliases: ["t"],
        description:
          "The release's tag, byte for byte: `0.28.0`, the version the job just shipped.",
      }),
    }),
    handler: async ({ flags }) => {
      const project = this.client.resolveProject(flags.project);
      const projectId = await this.projects.resolve(project);

      const releases = await this.api.getReleases({ params: { projectId } });
      const release = releases.find((it) => it.tag === flags.tag);

      if (!release) {
        this.log.info(
          `No release tagged ${flags.tag} in ${project}: nothing to publish`,
        );
        return;
      }

      if (release.releasedAt) {
        this.log.info(
          `Release ${flags.tag} in ${project} is already published, since ${release.releasedAt}`,
        );
        return;
      }

      const published = await this.api.publishRelease({
        params: { id: release.id },
        body: {},
      });
      this.log.info(`Published release ${published.tag} in ${project}`, {
        releasedAt: published.releasedAt,
      });
    },
  });

  public readonly releases = $command({
    name: "releases",
    description: "The releases of a Lore project",
    children: [this.publish],
    handler: async ({ help }) => {
      help();
    },
  });
}
