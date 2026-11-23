import { CommitReferenceRegistry, LoreAudits } from "@lore/core/api";
import { $inject, type Infer } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, NotFoundError } from "alepha/server";

import { GitBackend, type GitRefTip } from "../backends/GitBackend.ts";
import type { CodeCommitRow } from "../entities/codeCommits.ts";
import type { CodeRepository } from "../entities/codeRepositories.ts";
import { CodeBlameJobs } from "../jobs/CodeBlameJobs.ts";
import { CodeIndexJobs } from "../jobs/CodeIndexJobs.ts";
import type { codeBlameSchema } from "../schemas/codeBlameSchema.ts";
import type { codeBranchSchema } from "../schemas/codeBranchSchema.ts";
import type { codeCommitDetailSchema } from "../schemas/codeCommitDetailSchema.ts";
import type { codeCommitSummarySchema } from "../schemas/codeCommitSummarySchema.ts";
import type { codeCompareSchema } from "../schemas/codeCompareSchema.ts";
import type { codeFileSchema } from "../schemas/codeFileSchema.ts";
import type { codeLocationQuerySchema } from "../schemas/codeLocationQuerySchema.ts";
import type { codeLogEntrySchema } from "../schemas/codeLogEntrySchema.ts";
import type { codeLogSchema } from "../schemas/codeLogSchema.ts";
import type { codeRefSchema } from "../schemas/codeRefSchema.ts";
import type { codeRepositoryDetailSchema } from "../schemas/codeRepositoryDetailSchema.ts";
import type { codeRevisionSchema } from "../schemas/codeRevisionSchema.ts";
import type { codeTagSchema } from "../schemas/codeTagSchema.ts";
import type { codeTreeCommitsSchema } from "../schemas/codeTreeCommitsSchema.ts";
import type { codeTreeSchema } from "../schemas/codeTreeSchema.ts";
import { CodeAuthors } from "./CodeAuthors.ts";
import { CodeBlameService } from "./CodeBlameService.ts";
import { CodeCommitIndex } from "./CodeCommitIndex.ts";
import { CodeCompareService } from "./CodeCompareService.ts";
import { CodeRepositoryService } from "./CodeRepositoryService.ts";

type CommitSummary = Infer<typeof codeCommitSummarySchema>;
type Ref = Infer<typeof codeRefSchema>;
type Revision = Infer<typeof codeRevisionSchema>;
type Location = Infer<typeof codeLocationQuerySchema>;

/**
 * What the code browser reads of a repository (#E167), over the backend and
 * the commit index, for the pages and the `code_*` tools alike.
 */
export class CodeBrowserService {
  protected readonly backend = $inject(GitBackend);
  protected readonly index = $inject(CodeCommitIndex);
  protected readonly indexJobs = $inject(CodeIndexJobs);
  protected readonly repositories = $inject(CodeRepositoryService);
  protected readonly authors = $inject(CodeAuthors);
  protected readonly references = $inject(CommitReferenceRegistry);
  protected readonly comparer = $inject(CodeCompareService);
  protected readonly audits = $inject(LoreAudits);
  protected readonly blames = $inject(CodeBlameService);
  protected readonly blameJobs = $inject(CodeBlameJobs);

  /**
   * One commit's summary: the index's row, or the backend's commit while
   * the index has not reached it.
   */
  public async summary(
    repository: CodeRepository,
    sha: string,
  ): Promise<CommitSummary | undefined> {
    const row = await this.index.find(repository.id, sha);
    if (row) {
      return {
        sha: row.sha,
        subject: row.subject,
        authorName: row.authorName,
        authorEmail: row.authorEmail,
        authoredAt: row.authoredAt,
        committedAt: row.committedAt,
        parents: row.parents,
      };
    }
    const commit = await this.backend.commit(repository.backendRef, sha);
    if (!commit) return undefined;
    return {
      sha: commit.sha,
      subject: commit.subject,
      authorName: commit.author.name,
      authorEmail: commit.author.email,
      authoredAt: commit.author.at,
      committedAt: commit.committer.at,
      parents: commit.parents,
    };
  }

  /**
   * Branches and tags, short-named and sorted, a tag peeled to its commit.
   */
  public refsOf(tips: GitRefTip[]): { branches: Ref[]; tags: Ref[] } {
    const pick = (prefix: string) =>
      tips
        .filter((tip) => tip.name.startsWith(prefix))
        .map((tip) => ({
          name: tip.name.slice(prefix.length),
          sha: tip.targetSha ?? tip.sha,
        }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { branches: pick("refs/heads/"), tags: pick("refs/tags/") };
  }

  /**
   * The default branch's last commit, or undefined on an empty repository.
   */
  public async head(
    repository: CodeRepository,
  ): Promise<CommitSummary | undefined> {
    const sha = await this.backend.resolve(
      repository.backendRef,
      repository.defaultBranch,
    );
    return sha ? this.summary(repository, sha) : undefined;
  }

  /**
   * The repository page's header. Opening it starts the backfill when the
   * index lacks the default branch's tip: a repository from before the
   * index is indexed the first time anyone looks.
   */
  public async detail(
    repository: CodeRepository,
    base: string,
  ): Promise<Infer<typeof codeRepositoryDetailSchema>> {
    const tips = await this.backend.refs(repository.backendRef);
    const { branches, tags } = this.refsOf(tips);
    const tip = branches.find((it) => it.name === repository.defaultBranch);
    const indexed = tip
      ? Boolean(await this.index.find(repository.id, tip.sha))
      : true;
    if (!indexed) await this.indexJobs.start(repository.id);
    return {
      repository: await this.repositories.toResource(repository, base),
      branches,
      tags,
      head: tip ? await this.summary(repository, tip.sha) : undefined,
      indexing: !indexed,
    };
  }

  /**
   * The most bytes a file page shows as text; a bigger file is named and
   * downloaded raw.
   */
  public static readonly FILE_MAX_BYTES = 1024 * 1024;

  /**
   * The most bytes of a README a directory renders.
   */
  public static readonly README_MAX_BYTES = 256 * 1024;

  /**
   * How far back a tree's last-commit column looks, in commits: an entry
   * untouched since stays blank.
   */
  public static readonly TREE_COMMITS_DEPTH = 1000;

  /**
   * A location (`at`, or `ref` and `path`) as a revision and a path, or a
   * 404. See `codeLocationQuerySchema`.
   */
  public async locate(
    repository: CodeRepository,
    location: Location,
  ): Promise<{ revision: Revision; path: string }> {
    const found =
      location.at !== undefined
        ? await this.split(repository, location.at)
        : await this.revisionOf(repository, location.ref).then((revision) =>
            revision ? { revision, path: location.path ?? "" } : undefined,
          );
    const path = found ? GitBackend.cleanPath(found.path) : undefined;
    if (!found || path === undefined) {
      throw new NotFoundError("No such revision in this repository.");
    }
    return { revision: found.revision, path };
  }

  /**
   * `<revision>/<path>` split at the longest branch or tag name that
   * prefixes it, else at a commit sha (full, or a unique prefix the index
   * knows), the default branch when empty.
   */
  protected async split(
    repository: CodeRepository,
    at: string,
  ): Promise<{ revision: Revision; path: string } | undefined> {
    const tail = at.replace(/^\/+/, "");
    if (!tail) {
      const revision = await this.revisionOf(repository, undefined);
      return revision ? { revision, path: "" } : undefined;
    }
    const tips = await this.backend.refs(repository.backendRef);
    const { branches, tags } = this.refsOf(tips);
    let best: { revision: Revision; length: number } | undefined;
    for (const [kind, list] of [
      ["branch", branches],
      ["tag", tags],
    ] as const) {
      for (const ref of list) {
        if (tail !== ref.name && !tail.startsWith(`${ref.name}/`)) continue;
        // A branch wins over a tag of the same length, as `resolve` does.
        if (!best || ref.name.length > best.length) {
          best = {
            revision: { name: ref.name, kind, sha: ref.sha },
            length: ref.name.length,
          };
        }
      }
    }
    if (best) {
      return { revision: best.revision, path: tail.slice(best.length + 1) };
    }
    const [first = "", ...rest] = tail.split("/");
    const sha = await this.commitSha(repository, first);
    return sha
      ? { revision: { name: first, kind: "commit", sha }, path: rest.join("/") }
      : undefined;
  }

  /**
   * A revision named alone: a branch, a tag, a commit sha (full or a unique
   * prefix), the default branch when undefined.
   */
  public async revisionOf(
    repository: CodeRepository,
    ref: string | undefined,
  ): Promise<Revision | undefined> {
    const name = ref ?? repository.defaultBranch;
    const tips = await this.backend.refs(repository.backendRef);
    const { branches, tags } = this.refsOf(tips);
    const short = name.replace(/^refs\/(heads|tags)\//, "");
    const branch = branches.find((it) => it.name === short);
    if (branch && !name.startsWith("refs/tags/")) {
      return { name: short, kind: "branch", sha: branch.sha };
    }
    const tag = tags.find((it) => it.name === short);
    if (tag) return { name: short, kind: "tag", sha: tag.sha };
    const sha = await this.commitSha(repository, name);
    return sha ? { name, kind: "commit", sha } : undefined;
  }

  /**
   * A commit by its full sha (the backend's word) or a unique prefix of 7
   * or more (the index's).
   */
  protected async commitSha(
    repository: CodeRepository,
    value: string,
  ): Promise<string | undefined> {
    if (GitBackend.isSha(value)) {
      return this.backend.resolve(repository.backendRef, value);
    }
    const found = await this.index.byPrefix(repository.id, value);
    return found.length === 1 ? found[0] : undefined;
  }

  /**
   * One directory: folders first, then files, alphabetical, and its README
   * (`README.md` first, then any `README*`) as text.
   */
  public async tree(
    repository: CodeRepository,
    location: Location,
  ): Promise<Infer<typeof codeTreeSchema>> {
    const { revision, path } = await this.locate(repository, location);
    const entries = await this.backend.tree(
      repository.backendRef,
      revision.sha,
      path,
    );
    if (!entries) {
      throw new NotFoundError(
        `No directory ${path || "/"} at ${revision.name}.`,
      );
    }
    const sorted = [...entries].sort((a, b) => {
      const folder = (it: typeof a) => (it.type === "tree" ? 0 : 1);
      return (
        folder(a) - folder(b) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
    });
    const readme =
      sorted.find(
        (it) => it.type === "blob" && /^readme\.md$/i.test(it.name),
      ) ??
      sorted.find((it) => it.type === "blob" && /^readme(\.|$)/i.test(it.name));
    let readmeText: { path: string; text: string } | undefined;
    if (readme) {
      const read = await this.backend.blob(repository.backendRef, readme.sha, {
        maxBytes: CodeBrowserService.README_MAX_BYTES,
      });
      if (read.kind === "ok" && !read.binary) {
        readmeText = {
          path: path ? `${path}/${readme.name}` : readme.name,
          text: new TextDecoder().decode(read.bytes),
        };
      }
    }
    return {
      revision,
      path,
      entries: sorted.map((entry) => ({
        name: entry.name,
        path: path ? `${path}/${entry.name}` : entry.name,
        type: entry.type,
        mode: entry.mode,
        sha: entry.sha,
      })),
      readme: readmeText,
    };
  }

  /**
   * One file as text, or why not: binary, or over
   * {@link CodeBrowserService.FILE_MAX_BYTES}.
   */
  public async file(
    repository: CodeRepository,
    location: Location,
  ): Promise<Infer<typeof codeFileSchema>> {
    const { revision, path } = await this.locate(repository, location);
    const at = path.lastIndexOf("/");
    const entry = (
      await this.backend.tree(
        repository.backendRef,
        revision.sha,
        at === -1 ? "" : path.slice(0, at),
      )
    )?.find((it) => it.name === path.slice(at + 1) && it.type === "blob");
    if (!path || !entry) {
      throw new NotFoundError(`No file ${path} at ${revision.name}.`);
    }
    const read = await this.backend.blob(repository.backendRef, entry.sha, {
      maxBytes: CodeBrowserService.FILE_MAX_BYTES,
    });
    if (read.kind === "not_found") {
      throw new NotFoundError(`No file ${path} at ${revision.name}.`);
    }
    const base = {
      revision,
      path,
      sha: entry.sha,
    };
    if (read.kind === "too_large") {
      return { ...base, size: read.size, status: "too_large" };
    }
    if (read.binary) return { ...base, size: read.size, status: "binary" };
    return {
      ...base,
      size: read.size,
      status: "ok",
      text: new TextDecoder().decode(read.bytes),
    };
  }

  /**
   * The bytes of a file, for the raw download: capped at Artifacts' own
   * read limit, 32 MiB.
   */
  public async raw(
    repository: CodeRepository,
    location: Location,
  ): Promise<{ path: string; bytes: Uint8Array }> {
    const { revision, path } = await this.locate(repository, location);
    const read = await this.backend.file(
      repository.backendRef,
      revision.sha,
      path,
      {
        maxBytes: 32 * 1024 * 1024,
      },
    );
    if (read.kind !== "ok") {
      throw new NotFoundError(
        read.kind === "too_large"
          ? `${path} is too large to download from the browser: clone the repository.`
          : `No file ${path} at ${revision.name}.`,
      );
    }
    return { path, bytes: read.bytes };
  }

  /**
   * Each entry's last commit (#Q4134): the commits reachable from the
   * revision walked newest first, 50 at a time, from the index, until every
   * name has one or {@link CodeBrowserService.TREE_COMMITS_DEPTH} commits
   * are read. One reachability query and a few path reads, never one query
   * per entry.
   */
  public async lastCommits(
    repository: CodeRepository,
    location: Location,
    names: string[],
  ): Promise<Infer<typeof codeTreeCommitsSchema>> {
    const { revision, path } = await this.locate(repository, location);
    if (!(await this.index.find(repository.id, revision.sha))) {
      return { entries: [], indexing: true };
    }
    const wanted = new Set(names);
    const found = new Map<string, string>();
    const shas = await this.index.reachable(
      repository.id,
      revision.sha,
      CodeBrowserService.TREE_COMMITS_DEPTH,
    );
    const prefix = path ? `${path}/` : "";
    for (let i = 0; i < shas.length && found.size < wanted.size; i += 50) {
      const chunk = shas.slice(i, i + 50);
      const order = new Map(chunk.map((sha, index) => [sha, index]));
      const rows = (
        await this.index.pathsOf(repository.id, chunk, path || undefined)
      ).sort((a, b) => order.get(a.commitSha)! - order.get(b.commitSha)!);
      for (const row of rows) {
        for (const candidate of [row.path, row.oldPath]) {
          if (!candidate?.startsWith(prefix)) continue;
          const name = candidate.slice(prefix.length).split("/")[0]!;
          if (wanted.has(name) && !found.has(name)) {
            found.set(name, row.commitSha);
          }
        }
      }
    }
    const rows = new Map(
      (await this.index.many(repository.id, [...found.values()])).map((row) => [
        row.sha,
        row,
      ]),
    );
    return {
      indexing: false,
      entries: [...found].flatMap(([name, sha]) => {
        const row = rows.get(sha);
        return row
          ? [
              {
                name,
                commit: {
                  sha: row.sha,
                  subject: row.subject,
                  authorName: row.authorName,
                  authorEmail: row.authorEmail,
                  authoredAt: row.authoredAt,
                  committedAt: row.committedAt,
                  parents: row.parents,
                },
              },
            ]
          : [];
      }),
    };
  }

  /**
   * The most commits a history page lists.
   */
  public static readonly LOG_PAGE = 30;

  /**
   * A page of a revision's history (#Q4136), of a file or a folder when the
   * location names a path, from the commit index, each commit with its
   * quests and its author's member. While the index has not reached the
   * tip, an empty page that says `indexing`, and the backfill started.
   */
  public async log(
    repository: CodeRepository,
    location: Location,
    page = 0,
  ): Promise<Infer<typeof codeLogSchema>> {
    const { revision, path } = await this.locate(repository, location);
    if (!(await this.index.find(repository.id, revision.sha))) {
      await this.indexJobs.start(repository.id);
      return { revision, path, commits: [], page, more: false, indexing: true };
    }
    const limit = CodeBrowserService.LOG_PAGE;
    const { commits, more } = await this.index.log(
      repository.id,
      revision.sha,
      {
        path: path || undefined,
        offset: page * limit,
        limit,
      },
    );
    return {
      revision,
      path,
      page,
      more,
      indexing: false,
      commits: await this.decorate(repository, commits),
    };
  }

  /**
   * Index rows as history entries: their quests, one lookup for all of
   * them, and their authors' members, one more.
   */
  protected async decorate(
    repository: CodeRepository,
    commits: CodeCommitRow[],
  ): Promise<Infer<typeof codeLogEntrySchema>[]> {
    const [quests, members] = await Promise.all([
      this.references.questsForCommits(
        repository.projectId,
        commits.map((it) => it.sha),
      ),
      this.authors.of(
        repository.projectId,
        commits.map((it) => it.authorEmail),
      ),
    ]);
    return commits.map((row) => ({
      sha: row.sha,
      subject: row.subject,
      authorName: row.authorName,
      authorEmail: row.authorEmail,
      authoredAt: row.authoredAt,
      committedAt: row.committedAt,
      parents: row.parents,
      quests: quests.get(row.sha) ?? [],
      member: members.get(row.authorEmail.toLowerCase()),
    }));
  }

  /**
   * One commit by a full sha or a unique prefix (#Q4136), read from the
   * backend (whatever the index knows), with its quests and its author.
   */
  public async commitOf(
    repository: CodeRepository,
    value: string,
  ): Promise<Infer<typeof codeCommitDetailSchema>> {
    const sha = await this.commitSha(repository, value);
    const commit = sha
      ? await this.backend.commit(repository.backendRef, sha)
      : undefined;
    if (!commit)
      throw new NotFoundError(`No commit ${value} in this repository.`);
    const [quests, members] = await Promise.all([
      this.references.questsForCommits(repository.projectId, [commit.sha]),
      this.authors.of(repository.projectId, [commit.author.email]),
    ]);
    return {
      sha: commit.sha,
      parents: commit.parents,
      subject: commit.subject,
      body: commit.body,
      author: commit.author,
      committer: commit.committer,
      member: members.get(commit.author.email.toLowerCase()),
      quests: quests.get(commit.sha) ?? [],
    };
  }

  /**
   * Every branch with its last commit and its distance to the default
   * branch (#Q4137), the default one first.
   */
  public async branches(
    repository: CodeRepository,
  ): Promise<Infer<typeof codeBranchSchema>[]> {
    const { branches } = this.refsOf(
      await this.backend.refs(repository.backendRef),
    );
    const main = branches.find((it) => it.name === repository.defaultBranch);
    const known = await this.index.known(
      repository.id,
      branches.map((it) => it.sha),
    );
    const rows = new Map(
      (
        await this.index.many(
          repository.id,
          branches.map((it) => it.sha),
        )
      ).map((row) => [row.sha, row]),
    );
    const out = await Promise.all(
      branches.map(async (branch) => {
        const isDefault = branch.name === repository.defaultBranch;
        const indexed =
          known.has(branch.sha) && Boolean(main && known.has(main.sha));
        const counts =
          !isDefault && indexed && main
            ? await this.comparer.counts(repository, main.sha, branch.sha)
            : { ahead: 0, behind: 0, aheadCapped: false, behindCapped: false };
        const row = rows.get(branch.sha);
        return {
          name: branch.name,
          sha: branch.sha,
          isDefault,
          commit: row
            ? {
                sha: row.sha,
                subject: row.subject,
                authorName: row.authorName,
                authorEmail: row.authorEmail,
                authoredAt: row.authoredAt,
                committedAt: row.committedAt,
                parents: row.parents,
              }
            : await this.summary(repository, branch.sha),
          ...counts,
          indexing: !isDefault && !indexed,
        };
      }),
    );
    return out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  /**
   * Every tag, peeled, with the commit it points at (#Q4137).
   */
  public async tags(
    repository: CodeRepository,
  ): Promise<Infer<typeof codeTagSchema>[]> {
    const { tags } = this.refsOf(
      await this.backend.refs(repository.backendRef),
    );
    const rows = new Map(
      (
        await this.index.many(
          repository.id,
          tags.map((it) => it.sha),
        )
      ).map((row) => [row.sha, row]),
    );
    return Promise.all(
      tags.map(async (tag) => {
        const row = rows.get(tag.sha);
        return {
          name: tag.name,
          sha: tag.sha,
          commit: row
            ? {
                sha: row.sha,
                subject: row.subject,
                authorName: row.authorName,
                authorEmail: row.authorEmail,
                authoredAt: row.authoredAt,
                committedAt: row.committedAt,
                parents: row.parents,
              }
            : await this.summary(repository, tag.sha),
        };
      }),
    );
  }

  /**
   * `<base>...<head>` (#Q4137), each side a branch, a tag or a commit.
   */
  public async compare(
    repository: CodeRepository,
    base: string,
    head: string,
  ): Promise<Infer<typeof codeCompareSchema>> {
    const [a, b] = await Promise.all([
      this.revisionOf(repository, base),
      this.revisionOf(repository, head),
    ]);
    if (!a || !b) {
      throw new NotFoundError("No such revision in this repository.");
    }
    const result = await this.comparer.compare(repository, a.sha, b.sha);
    return {
      base: a,
      head: b,
      mergeBase: result.mergeBase,
      mergeBaseCapped: result.mergeBaseCapped,
      commits: await this.decorate(repository, result.commits),
      ahead: result.ahead,
      behind: result.behind,
      aheadCapped: result.aheadCapped,
      behindCapped: result.behindCapped,
      indexing: result.indexing,
    };
  }

  /**
   * Delete a branch that is not the default one (#Q4137), where it points
   * now, and say so in the project's activity.
   */
  public async deleteBranch(
    repository: CodeRepository,
    name: string,
    user: UserAccountToken | undefined,
  ): Promise<void> {
    if (name === repository.defaultBranch) {
      throw new BadRequestError(
        `${name} is the default branch: it is never deleted.`,
      );
    }
    const refName = `refs/heads/${name}`;
    const tip = (await this.backend.refs(repository.backendRef)).find(
      (it) => it.name === refName,
    );
    if (!tip) throw new NotFoundError(`No branch named ${name}.`);
    await this.backend.deleteRef(repository.backendRef, refName, tip.sha);
    await this.audits.code.logSuccess("delete-branch", {
      ...(user ? this.audits.actor(user) : {}),
      ...this.audits.scope(repository.projectId),
      resourceType: "code",
      resourceId: repository.slug,
      description: name,
      metadata: { branch: name, sha: tip.sha },
    });
  }

  /**
   * A file's blame at a location (#Q4138), each run's commit with its
   * quests. A walk the request did not finish is handed to `code.blame`.
   */
  public async blame(
    repository: CodeRepository,
    location: Location,
  ): Promise<Infer<typeof codeBlameSchema>> {
    const { revision, path } = await this.locate(repository, location);
    const answer = await this.blames.blame(repository, revision.sha, path);
    if (answer.kind === "not_found") {
      throw new NotFoundError(`No file ${path} at ${revision.name}.`);
    }
    if (answer.kind !== "row") {
      if (answer.kind === "indexing") await this.indexJobs.start(repository.id);
      return { revision, path, status: answer.kind, ranges: [], commits: [] };
    }
    const { row, text } = answer;
    if (row.status === "pending") await this.blameJobs.start(row.id);
    const shas = [
      ...new Set(
        row.ranges.flatMap((it) => (it.commitSha ? [it.commitSha] : [])),
      ),
    ];
    return {
      revision,
      path,
      status: row.status,
      text,
      ranges: row.ranges,
      commits: await this.decorate(
        repository,
        await this.index.many(repository.id, shas),
      ),
      stoppedAtSha: row.stoppedAtSha,
    };
  }
}
