import type {
  CodeBrowserController,
  CodeRepositoryController,
} from "@lore/build/api";
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
 * same action. Creating and deleting need `code:admin`, a project Admin's: a
 * `lore login` carries it (the `cli` scope), an MCP token does not.
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
  protected readonly browser = $client<CodeBrowserController>(
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
    description: "Create an empty git repository (project Admins only)",
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
      "Delete a git repository and everything in it (project Admins only)",
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

  /**
   * The flags every read takes (#Q4139): the project and the repository,
   * found from this checkout's Lore remote when neither is given, and the
   * revision.
   */
  protected static readonly READ_FLAGS = {
    ...CodeCommand.PROJECT_FLAG,
    repo: z
      .text({
        description:
          "The repository. Defaults to this checkout's Lore remote, else the one named like the project, else the only one.",
      })
      .optional(),
    ref: z
      .text({
        description:
          "A branch, a tag or a commit sha. Defaults to the default branch.",
      })
      .optional(),
  };

  protected static readonly LINES = 200;

  public readonly tree = $command({
    name: "tree",
    description: "A directory of a Lore repository at a branch, tag or commit",
    args: z
      .text({
        title: "path",
        description: "The directory. Defaults to the root.",
      })
      .optional(),
    flags: z.object({ ...CodeCommand.READ_FLAGS, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print, root }) => {
      await this.read(flags, root, async (target) => {
        const tree = await this.browser.getCodeTree({
          params: target,
          query: { ref: flags.ref, path: args ?? "" },
        });
        if (flags.output === "json") {
          this.render.json(print, tree.entries);
          return;
        }
        for (const entry of tree.entries) {
          print(`${entry.type === "tree" ? `${entry.name}/` : entry.name}`);
        }
      });
    },
  });

  public readonly cat = $command({
    name: "cat",
    description:
      "A file of a Lore repository, numbered, at most 200 lines unless --end-line says more",
    args: z.text({ title: "path", description: "The file, from the root" }),
    flags: z.object({
      ...CodeCommand.READ_FLAGS,
      "start-line": z.integer().describe("The first line, 1-based").optional(),
      "end-line": z.integer().describe("The last line, inclusive").optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, root }) => {
      await this.read(flags, root, async (target) => {
        const file = await this.browser.getCodeFile({
          params: target,
          query: { ref: flags.ref, path: args },
        });
        if (flags.output === "json") {
          this.render.json(print, file);
          return;
        }
        if (file.status !== "ok" || file.text === undefined) {
          print(`${file.path}: ${file.status} (${file.size} bytes)`);
          return;
        }
        const lines = this.linesOf(file.text);
        const from = flags["start-line"] ?? 1;
        const to = Math.min(
          flags["end-line"] ?? from + CodeCommand.LINES - 1,
          lines.length,
        );
        for (let i = from; i <= to; i++) print(`${i}\t${lines[i - 1]}`);
        if (to < lines.length) {
          print(`... ${lines.length - to} more lines: --start-line ${to + 1}`);
        }
      });
    },
  });

  public readonly log = $command({
    name: "log",
    description:
      "A Lore repository's history, newest first, 30 a page, optionally of one file or folder",
    args: z
      .text({ title: "path", description: "Only the commits that touched it" })
      .optional(),
    flags: z.object({
      ...CodeCommand.READ_FLAGS,
      page: z.integer().describe("The page, from 0").optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, root }) => {
      await this.read(flags, root, async (target) => {
        const log = await this.browser.getCodeLog({
          params: target,
          query: { ref: flags.ref, path: args, page: flags.page },
        });
        if (flags.output === "json") {
          this.render.json(print, log);
          return;
        }
        if (log.indexing) {
          print("Lore is still indexing this history: try again shortly.");
          return;
        }
        for (const commit of log.commits) {
          const quests = commit.quests.map((it) => `#Q${it.number}`).join(" ");
          print(
            `${commit.sha.slice(0, 9)}  ${new Date(commit.committedAt * 1000).toISOString().slice(0, 10)}  ${commit.authorName}  ${commit.subject}${quests ? `  ${quests}` : ""}`,
          );
        }
        if (log.more) print(`... more: --page ${log.page + 1}`);
      });
    },
  });

  public readonly show = $command({
    name: "show",
    description:
      "One commit: its message, parents, quests and the files it changed",
    args: z.text({
      title: "sha",
      description: "A full sha or a unique prefix",
    }),
    flags: z.object({
      ...CodeCommand.PROJECT_FLAG,
      repo: CodeCommand.READ_FLAGS.repo,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, root }) => {
      await this.read(flags, root, async (target) => {
        const commit = await this.browser.getCodeCommit({
          params: { ...target, sha: args },
        });
        const diff = await this.browser.getCodeDiff({
          params: target,
          query: { from: commit.parents[0], to: commit.sha },
        });
        if (flags.output === "json") {
          this.render.json(print, { ...commit, files: diff.files });
          return;
        }
        print(`commit ${commit.sha}`);
        if (commit.parents.length) print(`parents ${commit.parents.join(" ")}`);
        print(`author ${commit.author.name} <${commit.author.email}>`);
        print("");
        print(commit.subject);
        if (commit.body) print(`\n${commit.body}`);
        if (commit.quests.length) {
          print("");
          for (const quest of commit.quests) {
            print(`#Q${quest.number} ${quest.title} (${quest.status})`);
          }
        }
        print("");
        for (const file of diff.files) {
          print(
            `${file.kind.padEnd(9)} ${file.path}${file.additions !== undefined ? `  +${file.additions} -${file.deletions}` : ""}`,
          );
        }
      });
    },
  });

  public readonly diff = $command({
    name: "diff",
    description:
      "The diff between two revisions, <from>..<to>: the changed files, or one file's hunks",
    args: z
      .tuple([
        z.text({
          title: "range",
          description:
            "<from>..<to>, or <to> alone to diff from the empty tree",
        }),
        z.text({ title: "path", description: "One file's hunks" }).optional(),
      ])
      .meta({ title: "range" }),
    flags: z.object({
      ...CodeCommand.PROJECT_FLAG,
      repo: CodeCommand.READ_FLAGS.repo,
      page: z.integer().describe("The file list's page, from 0").optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, root }) => {
      const [range, path] = args;
      const [from, to] = range.includes("..")
        ? range.split(/\.\.\.?/, 2)
        : [undefined, range];
      if (!to) throw new UsageError("Name the range as <from>..<to>.");
      await this.read(flags, root, async (target) => {
        if (path) {
          const file = await this.browser.getCodeDiffFile({
            params: target,
            query: { from: from || undefined, to, path },
          });
          if (flags.output === "json") {
            this.render.json(print, file);
            return;
          }
          print(`--- ${file.oldPath ?? file.path}`);
          print(`+++ ${file.path}`);
          for (const hunk of file.hunks ?? []) {
            print(
              `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
            );
            for (const line of hunk.lines) {
              print(
                `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`,
              );
            }
          }
          if (file.status !== "loaded") print(`(${file.status})`);
          return;
        }
        const diff = await this.browser.getCodeDiff({
          params: target,
          query: { from: from || undefined, to, page: flags.page },
        });
        if (flags.output === "json") {
          this.render.json(print, diff);
          return;
        }
        for (const file of diff.files) {
          print(
            `${file.kind.padEnd(9)} ${file.path}${file.additions !== undefined ? `  +${file.additions} -${file.deletions}` : ""}`,
          );
        }
        print(`${diff.total} files changed`);
      });
    },
  });

  public readonly blame = $command({
    name: "blame",
    description:
      "Which commit, and which quest, each line of a file comes from",
    args: z.text({ title: "path", description: "The file, from the root" }),
    flags: z.object({
      ...CodeCommand.READ_FLAGS,
      "start-line": z.integer().describe("The first line, 1-based").optional(),
      "end-line": z.integer().describe("The last line, inclusive").optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, root }) => {
      await this.read(flags, root, async (target) => {
        const ask = () =>
          this.browser.getCodeBlame({
            params: target,
            query: { ref: flags.ref, path: args },
          });
        let blame = await ask();
        // A long walk finishes as a job: wait for it a little.
        for (let tries = 0; blame.status === "pending" && tries < 10; tries++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          blame = await ask();
        }
        if (flags.output === "json") {
          this.render.json(print, blame);
          return;
        }
        if (!blame.text) {
          print(`${blame.path}: ${blame.status}`);
          return;
        }
        const lines = this.linesOf(blame.text);
        const commits = new Map(blame.commits.map((it) => [it.sha, it]));
        const from = flags["start-line"] ?? 1;
        const to = Math.min(
          flags["end-line"] ?? from + CodeCommand.LINES - 1,
          lines.length,
        );
        for (const range of blame.ranges) {
          for (let line = range.startLine; line <= range.endLine; line++) {
            if (line < from || line > to) continue;
            const commit = range.commitSha
              ? commits.get(range.commitSha)
              : undefined;
            const quests =
              commit?.quests.map((it) => `#Q${it.number}`).join(",") ?? "";
            print(
              `${(range.commitSha ?? "older").slice(0, 9).padEnd(9)} ${(commit?.authorName ?? "").slice(0, 12).padEnd(12)} ${quests.padEnd(8)} ${String(line).padStart(5)}  ${lines[line - 1]}`,
            );
          }
        }
        if (blame.status === "pending") {
          print("... still finding the older lines: run it again shortly.");
        }
        if (to < lines.length) {
          print(`... ${lines.length - to} more lines: --start-line ${to + 1}`);
        }
      });
    },
  });

  protected linesOf(text: string): string[] {
    return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
  }

  /**
   * Run a read on the repository the flags or this checkout name.
   */
  protected async read(
    flags: { project?: string; repo?: string },
    root: string,
    fn: (target: { projectId: number; slug: string }) => Promise<void>,
  ): Promise<void> {
    const context: LoreRefusalContext = {};
    await this.refusals.guard(context, async () => {
      const detected =
        flags.project || flags.repo ? undefined : await this.fromRemote(root);
      const { project, projectId } = detected
        ? {
            project: detected.project,
            projectId: await this.projects.resolve(detected.project),
          }
        : await this.projects.named(flags.project, context);
      context.project = project;
      const repository = await this.pick(
        projectId,
        project,
        flags.repo ?? detected?.repo,
      );
      await fn({ projectId, slug: repository.slug });
    });
  }

  /**
   * The project and repository this checkout's Lore remote names (#Q4139):
   * the remote `lore` first, then `origin`, then any on this Lore's host,
   * read as `/<project>/<repo>.git` or `/<project>.git`.
   */
  protected async fromRemote(
    root: string,
  ): Promise<{ project: string; repo?: string } | undefined> {
    const out = await this.shell
      .run(["git", "remote", "-v"], { root, capture: true })
      .catch(() => "");
    const remotes = String(out)
      .split("\n")
      .map((line) => line.split(/\s+/))
      .filter((parts) => parts[0] && parts[1]);
    let host = "";
    try {
      host = new URL(this.client.hostname()).host;
    } catch {
      host = "";
    }
    const ordered = [
      ...remotes.filter((it) => it[0] === "lore"),
      ...remotes.filter((it) => it[0] === "origin"),
      ...remotes.filter((it) => it[0] !== "lore" && it[0] !== "origin"),
    ];
    for (const [name, url] of ordered) {
      let parsed: URL;
      try {
        parsed = new URL(url!);
      } catch {
        continue;
      }
      // Only `lore` is trusted on any host: an `origin` on another forge
      // names a path that is no Lore project.
      if (name !== "lore" && parsed.host !== host) continue;
      const match = /^\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?\.git\/?$/.exec(
        parsed.pathname,
      );
      if (match) return { project: match[1]!, repo: match[2] ?? match[1] };
    }
    return undefined;
  }

  public readonly code = $command({
    name: "code",
    description: "A project's git repositories on Lore",
    children: [
      this.repo,
      this.remote,
      this.import,
      this.tree,
      this.cat,
      this.log,
      this.show,
      this.diff,
      this.blame,
    ],
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
