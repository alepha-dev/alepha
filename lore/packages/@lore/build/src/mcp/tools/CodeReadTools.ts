import { ProjectTools } from "@lore/core/mcp";
import { $inject, AlephaError, z } from "alepha";
import { $tool } from "alepha/mcp";

import { CodeBrowserController } from "../../api/controllers/CodeBrowserController.ts";
import { CodeRepositoryController } from "../../api/controllers/CodeRepositoryController.ts";
import {
  codeBlameParamsSchema,
  codeCommitParamsSchema,
  codeDiffParamsSchema,
  codeFileParamsSchema,
  codeLogParamsSchema,
  codeTreeParamsSchema,
} from "../schemas/codeReadSchemas.ts";

/**
 * An agent reads code without a checkout (#Q4139): a directory, a file, a
 * history, a commit, a diff and a blame, each on the action its `lore code`
 * command calls (the parity rule), and each sized for a context window: a
 * file and a blame answer at most {@link CodeReadTools.LINES} lines and say
 * how to ask for the rest; a diff answers its file list first and one
 * file's hunks on demand.
 *
 * A job key reads the one repository it is pinned to: the actions 404 on
 * any other (`CodeReadAccess`).
 */
export class CodeReadTools {
  public static readonly LINES = 200;

  protected readonly browser = $inject(CodeBrowserController);
  protected readonly repositories = $inject(CodeRepositoryController);
  protected readonly projects = $inject(ProjectTools);

  protected readonly anything = z.record(z.text(), z.any());

  /**
   * The project and the repository a call names, the repository defaulting
   * to the one named like the project, else the only one.
   */
  protected async target(params: {
    project?: number;
    project_name?: string;
    repo?: string;
  }): Promise<{ projectId: number; slug: string }> {
    const projectId = await this.projects.resolveProjectId(
      params.project,
      params.project_name,
    );
    if (params.repo) return { projectId, slug: params.repo };
    const { repositories } = await this.repositories.listCodeRepositories({
      params: { projectId },
      query: {},
    });
    // The one named like the project clones from `/<project>.git`.
    const found =
      repositories.find((it) => {
        try {
          return new URL(it.cloneUrl).pathname === `/${it.slug}.git`;
        } catch {
          return false;
        }
      }) ?? (repositories.length === 1 ? repositories[0] : undefined);
    if (!found) {
      throw new AlephaError(
        repositories.length === 0
          ? "This project has no repository yet."
          : `Name the repository: ${repositories.map((it) => it.slug).join(", ")}.`,
      );
    }
    return { projectId, slug: found.slug };
  }

  protected window(start?: number, end?: number) {
    const from = start ?? 1;
    const to = Math.min(
      end ?? from + CodeReadTools.LINES - 1,
      from + CodeReadTools.LINES - 1,
    );
    return { from, to: Math.max(to, from) };
  }

  code_tree = $tool({
    title: "List a directory of a repository",
    description:
      "One directory of a Lore git repository at a branch, tag or commit: its folders and files. The repository defaults to the project's own, the ref to its default branch. `lore code tree [path]`.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: { params: codeTreeParamsSchema, result: this.anything },
    handler: async ({ params }) => {
      const target = await this.target(params);
      const tree = await this.browser.getCodeTree({
        params: target,
        query: { ref: params.ref, path: params.path ?? "" },
      });
      return {
        revision: tree.revision,
        path: tree.path,
        entries: tree.entries.map((it) => ({
          name: it.name,
          type:
            it.type === "tree"
              ? "dir"
              : it.type === "commit"
                ? "submodule"
                : "file",
          path: it.path,
        })),
        readme: tree.readme?.path,
      } as any;
    },
  });

  code_file = $tool({
    title: "Read a file of a repository",
    description:
      "A file of a Lore git repository at a branch, tag or commit, at most 200 lines a call (start_line, end_line), each line numbered; the answer says how to ask for the next lines. `lore code cat <path>`.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: { params: codeFileParamsSchema, result: this.anything },
    handler: async ({ params }) => {
      const target = await this.target(params);
      const file = await this.browser.getCodeFile({
        params: target,
        query: { ref: params.ref, path: params.path },
      });
      if (file.status !== "ok" || file.text === undefined) {
        return {
          revision: file.revision,
          path: file.path,
          status: file.status,
          size: file.size,
        } as any;
      }
      const lines = file.text.endsWith("\n")
        ? file.text.slice(0, -1).split("\n")
        : file.text.split("\n");
      const { from, to } = this.window(params.start_line, params.end_line);
      const last = Math.min(to, lines.length);
      return {
        revision: file.revision,
        path: file.path,
        status: file.status,
        total_lines: lines.length,
        start_line: from,
        end_line: last,
        text: lines
          .slice(from - 1, last)
          .map((line, i) => `${from + i}\t${line}`)
          .join("\n"),
        ...(last < lines.length
          ? { next: `Ask again with start_line ${last + 1} for the rest.` }
          : {}),
      } as any;
    },
  });

  code_log = $tool({
    title: "Read the history of a repository",
    description:
      "A Lore repository's history at a branch, tag or commit, newest first, 30 a page, optionally of one file or folder: each commit with its subject, author, date and the quests it landed on. `lore code log [path]`.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: { params: codeLogParamsSchema, result: this.anything },
    handler: async ({ params }) => {
      const target = await this.target(params);
      const log = await this.browser.getCodeLog({
        params: target,
        query: { ref: params.ref, path: params.path, page: params.page },
      });
      return {
        revision: log.revision,
        path: log.path,
        page: log.page,
        more: log.more,
        indexing: log.indexing,
        commits: log.commits.map((it) => ({
          sha: it.sha,
          subject: it.subject,
          author: it.member?.username ?? it.authorName,
          committed_at: new Date(it.committedAt * 1000).toISOString(),
          quests: it.quests.map((quest) => `#Q${quest.number}`),
        })),
      } as any;
    },
  });

  code_commit = $tool({
    title: "Read a commit",
    description:
      "One commit of a Lore repository: its message, author, parents, the quests it landed on, and the files it changed against its first parent with their counts. Read one file's hunks with code_diff. `lore code show <sha>`.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: { params: codeCommitParamsSchema, result: this.anything },
    handler: async ({ params }) => {
      const target = await this.target(params);
      const commit = await this.browser.getCodeCommit({
        params: { ...target, sha: params.sha },
      });
      const diff = await this.browser.getCodeDiff({
        params: target,
        query: { from: commit.parents[0], to: commit.sha },
      });
      return {
        ...commit,
        quests: commit.quests.map((quest) => ({
          ...quest,
          ref: `#Q${quest.number}`,
        })),
        files: diff.files.map((it) => ({
          path: it.path,
          old_path: it.oldPath,
          kind: it.kind,
          additions: it.additions,
          deletions: it.deletions,
        })),
        total_files: diff.total,
      } as any;
    },
  });

  code_diff = $tool({
    title: "Diff two revisions",
    description:
      "The diff between two revisions of a Lore repository. Without `path`: the changed files, 50 a page, with their counts. With `path`: that file's hunks as a unified diff. `lore code diff <from>..<to> [path]`.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: { params: codeDiffParamsSchema, result: this.anything },
    handler: async ({ params }) => {
      const target = await this.target(params);
      if (params.path) {
        const file = await this.browser.getCodeDiffFile({
          params: target,
          query: { from: params.from, to: params.to, path: params.path },
        });
        return {
          path: file.path,
          old_path: file.oldPath,
          kind: file.kind,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          diff: (file.hunks ?? [])
            .map((hunk) =>
              [
                `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
                ...hunk.lines.map(
                  (line) =>
                    `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`,
                ),
              ].join("\n"),
            )
            .join("\n"),
        } as any;
      }
      const diff = await this.browser.getCodeDiff({
        params: target,
        query: { from: params.from, to: params.to, page: params.page },
      });
      return {
        from: diff.from,
        to: diff.to,
        total: diff.total,
        page: diff.page,
        more: (diff.page + 1) * diff.pageSize < diff.total,
        partial: diff.partial,
        files: diff.files.map((it) => ({
          path: it.path,
          old_path: it.oldPath,
          kind: it.kind,
          status: it.status,
          additions: it.additions,
          deletions: it.deletions,
        })),
      } as any;
    },
  });

  code_blame = $tool({
    title: "Blame a file",
    description:
      "Which commit, and which quest, each line of a file comes from, at most 200 lines a call. Computed from Lore's commit index: a long file's first answer may say `pending: true`, ask again in a few seconds for the rest. `lore code blame <path>`.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: { params: codeBlameParamsSchema, result: this.anything },
    handler: async ({ params }) => {
      const target = await this.target(params);
      const blame = await this.browser.getCodeBlame({
        params: target,
        query: { ref: params.ref, path: params.path },
      });
      const { from, to } = this.window(params.start_line, params.end_line);
      const commits = new Map(blame.commits.map((it) => [it.sha, it]));
      const lines = blame.text
        ? (blame.text.endsWith("\n")
            ? blame.text.slice(0, -1)
            : blame.text
          ).split("\n")
        : [];
      const last = Math.min(to, lines.length);
      return {
        revision: blame.revision,
        path: blame.path,
        status: blame.status,
        pending: blame.status === "pending",
        ...(blame.status === "pending"
          ? {
              hint: "The older lines are still being found: ask again in a few seconds.",
            }
          : {}),
        total_lines: lines.length,
        start_line: from,
        end_line: last,
        runs: blame.ranges
          .filter((range) => range.endLine >= from && range.startLine <= last)
          .map((range) => {
            const commit = range.commitSha
              ? commits.get(range.commitSha)
              : undefined;
            return {
              start_line: Math.max(range.startLine, from),
              end_line: Math.min(range.endLine, last),
              sha: range.commitSha,
              subject: commit?.subject,
              author: commit?.member?.username ?? commit?.authorName,
              quests: commit?.quests.map((quest) => `#Q${quest.number}`) ?? [],
              ...(range.originalPath && range.originalPath !== blame.path
                ? { original_path: range.originalPath }
                : {}),
            };
          }),
        text: lines
          .slice(from - 1, last)
          .map((line, i) => `${from + i}\t${line}`)
          .join("\n"),
        ...(last < lines.length
          ? { next: `Ask again with start_line ${last + 1} for the rest.` }
          : {}),
      } as any;
    },
  });
}
