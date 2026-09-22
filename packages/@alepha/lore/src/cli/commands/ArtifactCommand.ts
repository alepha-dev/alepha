import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { $client } from "alepha/server/links";
import type { ArtifactController } from "lore/api/controllers/ArtifactController";

import { GitContextService } from "../services/GitContextService.ts";
import { LoreArtifactPusher } from "../services/LoreArtifactPusher.ts";
import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore artifacts push` - store what CI just built.
 *
 * ```bash
 * alepha build
 * export LORE_API_KEY=...
 * lore artifacts push --tag 1.2.3 --project alepha
 * ```
 *
 * The push itself is {@link LoreArtifactPusher}, which `lore deploy` and the
 * platform adapter call too: one packing and one upload for every caller.
 *
 * ## It packs for you, and that is not a convenience
 *
 * `alepha pack` stays, for anyone who wants the file. But requiring it as a
 * separate step means the tarball on disk and the build in `dist/` can differ,
 * and the push would happily ship the older one - a stale artifact that
 * deploys cleanly and runs the wrong code. Packing here makes that
 * unrepresentable.
 *
 * ## ⚠️ There is no `--runtime`, and there must never be one
 *
 * The runtime is read by Lore from the artifact's own `dist/manifest.json`. A
 * flag would eventually disagree with the manifest, and the manifest is the
 * artifact's own claim about itself. It is also why nothing here parses the
 * filename.
 *
 * ## Failing loudly is the design
 *
 * A push that cannot happen exits non-zero, matching `lore quality
 * push`. The safety is where the command runs rather than in a flag: the push
 * step is `continue-on-error` and gates no deploy, so a red push is a warning
 * annotation rather than a blocked release.
 */
export class ArtifactCommand {
  protected readonly log = $logger();
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly git = $inject(GitContextService);
  protected readonly pusher = $inject(LoreArtifactPusher);

  /**
   * ⚠️ Declared after `client`, and it has to be: a field initializer reading
   * another field sees `undefined` if that field is declared below it.
   *
   * `import type` above, so nothing of Lore's server graph is registered,
   * loaded or bundled - the same arrangement `QualityCommand` documents. What
   * it buys is that {@link pushImage}'s body is checked against the endpoint
   * that will answer it, with no hand-maintained wire contract to drift.
   */
  protected readonly api = $client<ArtifactController>(this.client.scope());

  /**
   * The tag a push carries when nobody names one.
   *
   * `latest` and not the version in `package.json`: `latest` is the mutable
   * tag, so the default push is the one that replaces rather than the one that
   * pins. A version pushed by accident is write-once and needs `--force` to
   * take back.
   */
  protected static readonly DEFAULT_TAG = "latest";

  public readonly push = $command({
    name: "push",
    description: "Pack the current build and push it to a Lore project",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description:
            "Lore project slug, overriding LORE_PROJECT for this invocation",
        })
        .optional(),
      app: z
        .text({
          description:
            "Name the artifact is filed under. Defaults to the slugified `name` from package.json.",
        })
        .optional(),
      tag: z
        .text({
          aliases: ["t"],
          description:
            "Version this build is named by. Defaults to `latest`, the one tag that may be replaced.",
        })
        .optional(),
      force: z
        .boolean()
        .describe(
          "Move a tag that already holds different bytes. Only ever needed for a pinned tag, and only for 'tagged the wrong commit'.",
        )
        .optional(),
    }),
    handler: async ({ flags, root, run }) => {
      await this.pusher.push({
        root,
        project: this.client.resolveProject(flags.project),
        app: await this.projects.resolveApp(flags.app, root),
        tag: flags.tag ?? ArtifactCommand.DEFAULT_TAG,
        force: flags.force,
        run,
      });
    },
  });

  /**
   * `lore artifacts push-image` - record a container image CI just pushed.
   *
   * ```bash
   * docker buildx build --push -t ghcr.io/alepha-dev/lore:0.30.0 dist
   * export LORE_API_KEY=...
   * lore artifacts push-image --tag 0.30.0 --image ghcr.io/alepha-dev/lore:0.30.0
   * ```
   *
   * ## ⚠️ A sibling verb, not a mode of `push`
   *
   * `push` packs the workspace, and its own doc says that is deliberate rather
   * than a convenience. A reference push shares none of that machinery and
   * none of its failure modes: nothing is packed, nothing is uploaded, and the
   * expensive part is four bounded calls Lore makes to a registry. Folding the
   * two together would put two unrelated failure surfaces behind one verb.
   *
   * Not through {@link ArtifactUploader} either. That exists because
   * `HttpClient` cannot stream a multipart body without materialising the
   * whole tarball, so it hand-composes a pull-driven `ReadableStream`. None of
   * that applies to a few hundred bytes of JSON.
   *
   * ## ⚠️ No `--runtime`, and no `--arch` either
   *
   * The same rule `push` carries, now covering two fields. The runtime is read
   * by Lore from the image's own `dev.alepha.runtime` label, and the platforms
   * are inside its index. Neither is the caller's to assert.
   *
   * There is no branch here that rejects them: `CliProvider` throws
   * `Unknown flag` on anything it was not given, so "rejects them by not
   * having them" is enforced by the framework rather than by code that could
   * be deleted.
   */
  public readonly pushImage = $command({
    name: "push-image",
    description: "Record a container image CI pushed, by reference",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description:
            "Lore project slug, overriding LORE_PROJECT for this invocation",
        })
        .optional(),
      app: z
        .text({
          description:
            "Name the artifact is filed under. Defaults to the slugified `name` from package.json.",
        })
        .optional(),
      tag: z
        .text({
          aliases: ["t"],
          description:
            "Version this image is named by. Defaults to `latest`, the one tag that may be replaced.",
        })
        .optional(),
      image: z
        .text({
          aliases: ["i"],
          description:
            "The pullable reference, e.g. ghcr.io/alepha-dev/lore:0.30.0. Only ghcr.io is supported today.",
        })
        .optional(),
      digest: z
        .text({
          description:
            "The index digest this push believes it pushed. Refused if the registry reports a different one.",
        })
        .optional(),
      force: z
        .boolean()
        .describe(
          "Move a tag that already names a different image. Only ever needed for a pinned tag.",
        )
        .optional(),
    }),
    handler: async ({ flags, root }) => {
      const project = this.client.resolveProject(flags.project);
      const app = await this.projects.resolveApp(flags.app, root);
      const tag = flags.tag ?? ArtifactCommand.DEFAULT_TAG;

      // ⚠️ Refused here rather than sent as an empty string. The endpoint
      // would answer 400 either way, but a CI log saying which FLAG is
      // missing is the difference between a one-line fix and reading a
      // request body.
      const reference = flags.image;
      if (!reference) {
        throw new AlephaError(
          "No image named. Pass --image <reference> (or -i), for example `--image ghcr.io/alepha-dev/lore:0.30.0`.",
        );
      }

      const [projectId, git] = await Promise.all([
        this.projects.resolve(project),
        this.git.resolve(root),
      ]);

      // ⚠️ `$client` answers the response BODY, not an envelope: there is no
      // `.data` here, unlike a `.fetch()` call inside the app's own specs.
      const result = await this.api.pushImage({
        params: { projectId },
        body: {
          app,
          tag,
          reference,
          commitSha: git.commitSha,
          force: flags.force,
          digest: flags.digest,
        },
      });

      const { artifact } = result;
      this.log.info(
        result.stored
          ? `Recorded ${artifact.app} ${artifact.tag} (${artifact.runtime}, image) in ${project}`
          : `${artifact.app} ${artifact.tag} (${artifact.runtime}, image) was already recorded in ${project}`,
        { reference: artifact.reference, sha256: artifact.sha256 },
      );
      this.log.info(`sha256: ${artifact.sha256}`);

      await this.pusher.publishOutput(artifact.sha256);
    },
  });

  public readonly artifacts = $command({
    name: "artifacts",
    description: "Builds this project has kept",
    children: [this.push, this.pushImage],
    handler: async ({ help }) => {
      help();
    },
  });

  /*
    The app name used to be derived here, from `package.json` slugified through
    the packer. It moved to `LoreProjectResolver.resolveApp` with #1811, which
    added `LORE_APP` to the chain: `lore apps deploy` needs the same answer, and
    a second derivation of one name is what let `pack` write one file while
    `BayAdapter` looked for another.
  */
}
