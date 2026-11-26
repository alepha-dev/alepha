import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

import { AttachmentDownloader } from "../services/AttachmentDownloader.ts";
import { AttachmentUploader } from "../services/AttachmentUploader.ts";
import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore attachments push` - put a file on a quest or in a folio, and
 * `lore attachments pull` - get one back (#Q4513).
 *
 * ```bash
 * export LORE_API_KEY=...
 * lore attachments push ./chart.png   --project alepha --quest 1208
 * lore attachments push ./mockup.html --project alepha --folio 12 --name hero.html
 * lore attachments pull hero.html     --project alepha --folio 12 --out ./mockups/
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
  protected readonly downloader = $inject(AttachmentDownloader);

  public readonly push = $command({
    name: "push",
    description: "Attach a file to a quest, a folio, or a use case run",
    args: z.text({ title: "file", description: "Path to the file to attach" }),
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
      run: z
        .number()
        .describe(
          "A use case run's id, as `lore usecase run record` prints it: the file is evidence of that run (50 MB a file).",
        )
        .optional(),
      criterion: z
        .text({ description: "With --run: the criterion the file shows, C2." })
        .optional(),
      step: z
        .number()
        .describe("With --run: the scenario step the file shows.")
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

      if (
        [flags.quest, flags.folio, flags.run].filter((it) => it != null)
          .length !== 1
      ) {
        throw new AlephaError(
          "Name exactly one target: --quest <shortId>, --folio <shortId> or --run <id>.",
        );
      }

      const pushed =
        flags.run != null
          ? await this.uploader.pushToRun({
              projectId,
              runId: flags.run,
              filePath,
              name: flags.name,
              type: flags.type,
              criterionKey: flags.criterion,
              step: flags.step,
            })
          : flags.quest != null
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

  /**
   * `lore attachments pull` (#Q4513): the file back, from a folio by its
   * name or shortId, or from a quest by its name or file id, written where
   * the command runs or to `--out`.
   */
  public readonly pull = $command({
    name: "pull",
    description: "Download a file attached to a folio or a quest",
    args: z.text({
      title: "attachment",
      description:
        "The attachment's name, or on a folio its shortId (folio_attachment_list), on a quest its file id (quest_get attachments[].id)",
    }),
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
        .describe("The quest's shortId. Mutually exclusive with --folio.")
        .optional(),
      folio: z
        .number()
        .describe("The folio's shortId. Mutually exclusive with --quest.")
        .optional(),
      out: z
        .text({
          aliases: ["o"],
          description:
            "Where to write it: a file path, or a directory to put it in. Defaults to the attachment's name in the current directory.",
        })
        .optional(),
    }),
    handler: async ({ args, flags, root }) => {
      const project = this.client.resolveProject(flags.project);
      const projectId = await this.projects.resolve(project);
      if ((flags.quest == null) === (flags.folio == null)) {
        throw new AlephaError(
          "Name exactly one source: --folio <shortId> or --quest <shortId>.",
        );
      }
      const pulled =
        flags.folio != null
          ? await this.downloader.pullFromFolio({
              projectId,
              folioShortId: flags.folio,
              ref: args,
              root,
              ...(flags.out ? { out: flags.out } : {}),
            })
          : await this.downloader.pullFromQuest({
              projectId,
              questShortId: flags.quest!,
              ref: args,
              root,
              ...(flags.out ? { out: flags.out } : {}),
            });
      this.log.info(
        `Saved ${pulled.name} to ${pulled.path}`,
        pulled.size === undefined ? {} : { size: pulled.size },
      );
    },
  });

  public readonly attachments = $command({
    name: "attachments",
    description: "Files on a project's quests and folios",
    children: [this.push, this.pull],
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
