import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

import { AttachmentUploader } from "../services/AttachmentUploader.ts";
import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore attachments push` - put a file on a quest or in a folio.
 *
 * ```bash
 * export LORE_API_KEY=...
 * lore attachments push ./chart.png   --project alepha --quest 1208
 * lore attachments push ./mockup.html --project alepha --folio 12 --name hero.html
 * ```
 *
 * ## Why the bytes moved off MCP
 *
 * Uploading over MCP means base64 inside a JSON-RPC frame, which is why
 * `quest_attachment_add` and `folio_attachment_add` capped every attachment at
 * 2 MB. That cap was never a policy anyone chose - the server is more generous
 * than the tool was, at 10 MB for a quest and no limit at all for a folio - and
 * agents hit it on the exact files a quest is worked from: a screenshot at
 * retina width, an HTML mockup with an inlined font, a CSV of measurements.
 *
 * `AttachmentUploader` streams instead, at one chunk of peak memory, the same
 * way `lore artifacts push` already ships a tarball. The two MCP tools survive
 * as name and description: they resolve the target, confirm it exists, and
 * hand back the command line to run. Deleting them outright was rejected -
 * an agent scanning its tool list for "attach a file to a quest" would find
 * nothing and paste the file into a comment as text.
 *
 * ## One file per invocation
 *
 * `$command`'s `args` takes a value or a tuple, not a variadic, and a shell
 * loop covers the rest. `--quest` and `--folio` are mutually exclusive and
 * exactly one is required, both taking the **shortId** - the number in Lore's
 * URLs and in `quest_get` - rather than the internal id.
 *
 * ## Failing loudly is the design
 *
 * A push that cannot happen exits non-zero, matching `lore artifacts push` and
 * `lore quality push`. There is nothing here for a `continue-on-error` step to
 * hide behind: this command is run by a person or an agent, not by CI.
 */
export class AttachmentCommand {
  protected readonly log = $logger();
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly uploader = $inject(AttachmentUploader);

  public readonly push = $command({
    name: "push",
    description: "Attach a file to a quest or a folio",
    args: z.text().describe("Path to the file to attach"),
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description:
            "Lore project slug, overriding LORE_PROJECT for this invocation",
        })
        .optional(),
      quest: z
        .number()
        .describe(
          "The quest's shortId - the number in its URL and in `quest_get`, not the internal id. Mutually exclusive with --folio.",
        )
        .optional(),
      folio: z
        .number()
        .describe("The folio's shortId. Mutually exclusive with --quest.")
        .optional(),
      name: z
        .text({
          description:
            "Name to store the file under. Defaults to the on-disk filename. A folio auto-suffixes a name already taken on it, and the stored name is what is printed.",
        })
        .optional(),
      type: z
        .text({
          description:
            "Media type, e.g. `text/html`. Defaults to a guess from the extension, with `application/octet-stream` as the floor.",
        })
        .optional(),
    }),
    handler: async ({ args, flags, root }) => {
      const project = this.client.resolveProject(flags.project);
      const projectId = await this.projects.resolve(project);
      // Relative to where the command was run, which is what a person typing
      // `./chart.png` means. `resolve` leaves an absolute path alone.
      const filePath = this.uploaderPath(root, args);

      if ((flags.quest == null) === (flags.folio == null)) {
        throw new AlephaError(
          "Name exactly one target: --quest <shortId> or --folio <shortId>.",
        );
      }

      const pushed =
        flags.quest != null
          ? await this.uploader.pushToQuest({
              projectId,
              questShortId: flags.quest,
              filePath,
              name: flags.name,
              type: flags.type,
            })
          : await this.uploader.pushToFolio({
              projectId,
              folioShortId: flags.folio!,
              filePath,
              name: flags.name,
              type: flags.type,
            });

      this.log.info(
        `Attached ${pushed.name} (${pushed.mimeType}) to ${pushed.subject} in ${project}`,
        // `path` only exists for a folio, and it is the thing to paste into
        // the body: a file nothing references is a file nobody finds.
        pushed.path ? { reference: pushed.path } : { size: pushed.size },
      );
      if (pushed.path) {
        this.log.info(`reference: ${pushed.path}`);
      }
    },
  });

  public readonly attachments = $command({
    name: "attachments",
    description: "Files on a project's quests and folios",
    children: [this.push],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * Where the file actually is.
   *
   * Resolved against the command's own root rather than left to the
   * filesystem provider's cwd, so `./chart.png` means what the person typing
   * it meant - and so a test driving the command through a
   * `MemoryFileSystemProvider` gets the same answer.
   */
  protected uploaderPath(root: string, path: string): string {
    return path.startsWith("/") ? path : `${root.replace(/\/$/, "")}/${path}`;
  }
}
