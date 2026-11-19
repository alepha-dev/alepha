import type { CodeRepositoryController } from "@lore/build/api";
import { $inject, AlephaError, z } from "alepha";
import { $command, UsageError } from "alepha/command";
import { $client } from "alepha/server/links";
import { ShellProvider } from "alepha/system";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreCodeImport } from "../services/LoreCodeImport.ts";
import { LoreGitCredentials } from "../services/LoreGitCredentials.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * Lore's git repositories from a shell (#Q3934, folio #F1500 "CLI"):
 * `lore clone`, `lore code repo list|create|delete`, `lore code remote`, and
 * `lore git-credential`, the helper git calls.
 *
 * Each `lore code repo` verb has its MCP tool (`code_repo_*`) and calls the
 * same action. Creating and deleting need `code:admin`, which no login token
 * carries: with a `lore login` they answer 403, and `LORE_API_KEY` set to an
 * Admin's key does them.
 */
export class CodeCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);
  protected readonly credentials = $inject(LoreGitCredentials);
  protected readonly shell = $inject(ShellProvider);
  protected readonly importer = $inject(LoreCodeImport);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly api = $client<CodeRepositoryController>(
    this.client.scope(),
  );

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  public readonly list = $command({
    name: "list",
    description: "The project's git repositories, with their clone URLs",
    flags: z.object({ ...CodeCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { repositories } = await this.api.listCodeRepositories({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, repositories);
          return;
        }
        if (repositories.length === 0) {
          print("No repository yet: `lore code repo create <name>`.");
          return;
        }
        for (const repository of repositories) {
          print(`${repository.slug}  ${repository.cloneUrl}`);
        }
      });
    },
  });

  public readonly create = $command({
    name: "create",
    description:
      "Create an empty git repository (needs code:admin: an Admin's API key, not a login)",
    args: z.text({
      title: "slug",
      description: "The repository's name, [a-z0-9-]",
    }),
    flags: z.object({
      ...CodeCommand.PROJECT_FLAG,
      "default-branch": z
        .text({ description: "The branch HEAD names. Defaults to main." })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const created = await this.api.createCodeRepository({
          params: { projectId },
          body: {
            slug: args,
            ...(flags["default-branch"]
              ? { defaultBranch: flags["default-branch"] }
              : {}),
          },
        });
        if (flags.output === "json") {
          this.render.json(print, created);
          return;
        }
        print(`Created ${created.slug}: ${created.cloneUrl}`);
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description:
      "Delete a git repository and everything in it (needs code:admin: an Admin's API key, not a login)",
    args: z.text({ title: "slug", description: "The repository to delete" }),
    flags: z.object({ ...CodeCommand.PROJECT_FLAG }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        await this.api.deleteCodeRepository({
          params: { projectId, slug: args },
        });
        print(`Deleted ${args}.`);
      });
    },
  });

  public readonly repo = $command({
    name: "repo",
    description: "A project's git repositories: list, create, delete",
    children: [this.list, this.create, this.delete],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly remote = $command({
    name: "remote",
    description:
      "Print a repository's Lore clone URL, or add it as a remote of this checkout with --add",
    flags: z.object({
      ...CodeCommand.PROJECT_FLAG,
      repo: z
        .text({
          description:
            "The repository. Defaults to the one named like the project, or the only one.",
        })
        .optional(),
      add: z
        .boolean()
        .describe("Add the URL as a git remote of the current checkout")
        .optional(),
      name: z
        .text({
          description: "The remote's name with --add. Defaults to lore.",
        })
        .optional(),
    }),
    handler: async ({ flags, print, root }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const repository = await this.pick(projectId, project, flags.repo);
        if (!flags.add) {
          print(repository.cloneUrl);
          return;
        }
        const name = flags.name ?? "lore";
        await this.shell.run(
          ["git", "remote", "add", name, repository.cloneUrl],
          { root },
        );
        await this.credentials.install(this.client.hostname());
        print(`Added the remote ${name}: ${repository.cloneUrl}`);
      });
    },
  });

  public readonly import = $command({
    name: "import",
    description:
      "Push this checkout into a new or empty Lore repository, in slices a large history needs; resumable",
    args: z
      .text({
        title: "repo",
        description:
          "The repository. Defaults to the one named like the project; created when absent.",
      })
      .optional(),
    flags: z.object({
      ...CodeCommand.PROJECT_FLAG,
      branch: z
        .text({
          description:
            "The local branch that becomes the default one. Defaults to the checked-out branch.",
        })
        .optional(),
      "max-objects": z
        .integer()
        .describe("New objects per push, 40000 by default")
        .optional(),
      "max-mb": z
        .integer()
        .describe("Packed MiB per push, 60 by default")
        .optional(),
    }),
    handler: async ({ args, flags, print, root }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { project, projectId } = await this.projects.named(
          flags.project,
          context,
        );
        const source =
          flags.branch ??
          (
            await this.shell.run(["git", "symbolic-ref", "--short", "HEAD"], {
              root,
              capture: true,
            })
          ).trim();
        const slug = args ?? project;
        const { repositories } = await this.api.listCodeRepositories({
          params: { projectId },
        });
        const repository =
          repositories.find((it) => it.slug === slug) ??
          (await this.api.createCodeRepository({
            params: { projectId },
            body: { slug, defaultBranch: source },
          }));
        await this.credentials.install(this.client.hostname());
        const result = await this.importer.run({
          root,
          url: repository.cloneUrl,
          source,
          branch: repository.defaultBranch,
          sliced: repository.backend === "artifacts",
          maxObjects: flags["max-objects"],
          maxBytes: flags["max-mb"] ? flags["max-mb"] * 1024 * 1024 : undefined,
          log: (line) => print(line),
        });
        print(
          `Imported ${source} as ${repository.defaultBranch} (${result.head.slice(0, 9)}) into ${repository.cloneUrl}, in ${result.pushes} pushes.`,
        );
      });
    },
  });

  public readonly code = $command({
    name: "code",
    description: "A project's git repositories on Lore",
    children: [this.repo, this.remote, this.import],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly clone = $command({
    name: "clone",
    description:
      "Clone a Lore repository, <project>[/<repo>], into [dir], with the credential helper installed",
    args: z
      .tuple([
        z.text({
          title: "repository",
          description: "<project> or <project>/<repo>",
        }),
        z.text({ title: "dir", description: "Where to clone it" }).optional(),
      ])
      .meta({ title: "repository" }),
    handler: async ({ args, print, root }) => {
      const [target, dir] = args;
      const [project, repo, extra] = target.split("/");
      if (!project || extra !== undefined) {
        throw new UsageError(
          "Name the repository as <project> or <project>/<repo>.",
        );
      }
      const context: LoreRefusalContext = { project };
      await this.refusals.guard(context, async () => {
        const projectId = await this.projects.resolve(project);
        const repository = await this.pick(projectId, project, repo);
        await this.credentials.install(this.client.hostname());
        await this.shell.run(
          ["git", "clone", repository.cloneUrl, ...(dir ? [dir] : [])],
          { root },
        );
        print(`Cloned ${repository.cloneUrl}`);
      });
    },
  });

  public readonly gitCredential = $command({
    name: "git-credential",
    description:
      "git's credential helper for Lore hosts, installed by `lore login` and `lore clone`; not for typing",
    args: z
      .text({ title: "operation", description: "get, store or erase" })
      .optional(),
    handler: async ({ args, print }) => {
      if (args !== "get") {
        // `store` and `erase`: a short-lived token is never kept anywhere.
        return;
      }
      const fields = this.credentials.parse(await this.readStdin());
      if (fields.host && !this.client.hostnameFromEnv()) {
        this.client.useUrl(`${fields.protocol ?? "https"}://${fields.host}`);
      }
      let authorization: string;
      try {
        authorization = await this.client.authorization();
      } catch {
        // Not signed in to that host: answer nothing, and git says so.
        return;
      }
      print(
        this.credentials
          .answer(authorization.replace(/^Bearer\s+/i, ""))
          .trimEnd(),
      );
    },
  });

  /**
   * The repository a command means: the one named, else the one named like
   * the project, else the only one.
   */
  protected async pick(projectId: number, project: string, repo?: string) {
    const { repositories } = await this.api.listCodeRepositories({
      params: { projectId },
    });
    const found = repo
      ? repositories.find((it) => it.slug === repo)
      : (repositories.find((it) => it.slug === project) ??
        (repositories.length === 1 ? repositories[0] : undefined));
    if (!found) {
      throw new AlephaError(
        repo
          ? `Project ${project} has no repository named ${repo}.`
          : repositories.length === 0
            ? `Project ${project} has no repository yet: \`lore code repo create <name> -p ${project}\`.`
            : `Project ${project} has several repositories: name one, <project>/<repo> (${repositories.map((it) => it.slug).join(", ")}).`,
      );
    }
    return found;
  }

  protected async readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}
