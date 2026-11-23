import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action, NotFoundError } from "alepha/server";
import { FileSystemProvider } from "alepha/system";

import { codeCommitDetailSchema } from "../schemas/codeCommitDetailSchema.ts";
import { codeDiffFileSchema } from "../schemas/codeDiffFileSchema.ts";
import { codeDiffSchema } from "../schemas/codeDiffSchema.ts";
import { codeFileSchema } from "../schemas/codeFileSchema.ts";
import { codeLocationQuerySchema } from "../schemas/codeLocationQuerySchema.ts";
import { codeLogSchema } from "../schemas/codeLogSchema.ts";
import { codeRepositoryDetailSchema } from "../schemas/codeRepositoryDetailSchema.ts";
import { codeRepositorySlugSchema } from "../schemas/codeRepositorySlugSchema.ts";
import { codeTreeCommitsSchema } from "../schemas/codeTreeCommitsSchema.ts";
import { codeTreeSchema } from "../schemas/codeTreeSchema.ts";
import { CodeBrowserService } from "../services/CodeBrowserService.ts";
import { CodeDiffService } from "../services/CodeDiffService.ts";
import { CodeReadAccess } from "../services/CodeReadAccess.ts";
import { CodeRepositoryService } from "../services/CodeRepositoryService.ts";

/**
 * The code browser's reads (#E167): what the pages under `/<project>/code`
 * and the `code_*` tools call.
 *
 * Every action is `code:read` (`$ownsProject`) and 404s with Build's
 * `repositories` off or for a repository a job key is not pinned to
 * (`CodeReadAccess`). Action names are the CLI's wire contract.
 */
export class CodeBrowserController {
  protected readonly access = $inject(CodeReadAccess);
  protected readonly browser = $inject(CodeBrowserService);
  protected readonly repositories = $inject(CodeRepositoryService);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly diffs = $inject(CodeDiffService);

  protected readonly repoParams = z.object({
    projectId: z.integer(),
    slug: codeRepositorySlugSchema,
  });

  protected readGate = () =>
    $ownsProject({ param: "projectId", requires: "code:read" });

  getCodeRepository = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/code/repos/:slug",
    description:
      "A repository's branches, tags and the default branch's last commit.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        slug: codeRepositorySlugSchema,
      }),
      response: codeRepositoryDetailSchema,
    },
    handler: async ({ params, user, url }) => {
      const row = await this.access.repository(
        params.projectId,
        params.slug,
        user,
      );
      return this.browser.detail(row, this.repositories.baseUrl(url));
    },
  });

  getCodeTree = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/code/repos/:slug/tree",
    description:
      "One directory of a repository at a revision, folders first, with its README.",
    schema: {
      params: this.repoParams,
      query: codeLocationQuerySchema,
      response: codeTreeSchema,
    },
    handler: async ({ params, query, user }) => {
      const row = await this.access.repository(
        params.projectId,
        params.slug,
        user,
      );
      return this.browser.tree(row, query);
    },
  });

  /**
   * A POST because it names the entries to look up, which a directory may
   * hold hundreds of: a read all the same.
   */
  getCodeTreeCommits = $action({
    use: [this.readGate()],
    method: "POST",
    path: "/projects/:projectId/code/repos/:slug/tree-commits",
    description:
      "The last commit that touched each named entry of a directory, from the commit index.",
    schema: {
      params: this.repoParams,
      body: codeLocationQuerySchema.extend({
        names: z.array(z.text({ maxLength: 1024 })).max(2000),
      }),
      response: codeTreeCommitsSchema,
    },
    handler: async ({ params, body, user }) => {
      const row = await this.access.repository(
        params.projectId,
        params.slug,
        user,
      );
      const { names, ...location } = body;
      return this.browser.lastCommits(row, location, names);
    },
  });

  getCodeFile = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/code/repos/:slug/file",
    description:
      "One file of a repository at a revision, as text, or why not (binary, too large).",
    schema: {
      params: this.repoParams,
      query: codeLocationQuerySchema,
      response: codeFileSchema,
    },
    handler: async ({ params, query, user }) => {
      const row = await this.access.repository(
        params.projectId,
        params.slug,
        user,
      );
      return this.browser.file(row, query);
    },
  });

  /**
   * A file's bytes, `/raw/<revision>/<path>` (#Q4134): the download link,
   * and the `src` of a README's images.
   *
   * ⚠️ Repository content on Lore's own origin is stored XSS waiting: an
   * HTML or SVG file opened here would run with the reader's session. So
   * every answer is `Content-Disposition: attachment` (`z.file()` sets it
   * whatever the type; an `<img>` still draws an image), `nosniff`, and a
   * sandboxing CSP, so even a browser that renders it runs nothing.
   */
  downloadCodeRaw = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/code/repos/:slug/raw/*",
    description: "A file's bytes at a revision, as a download.",
    schema: {
      params: this.repoParams.extend({ "*": z.text({ maxLength: 4096 }) }),
      response: z.file(),
    },
    handler: async ({ params, user, reply }) => {
      const row = await this.access.repository(
        params.projectId,
        params.slug,
        user,
      );
      const { path, bytes } = await this.browser.raw(row, {
        at: decodeURIComponent(params["*"]),
      });
      reply.setHeader("x-content-type-options", "nosniff");
      reply.setHeader("content-security-policy", "sandbox");
      reply.setHeader("cache-control", "private, no-cache");
      return this.fs.createFile({
        buffer: bytes,
        name: path.slice(path.lastIndexOf("/") + 1),
      });
    },
  });

  /**
   * Two revisions' shas, or a 404: `from` omitted is the empty tree.
   */
  protected async pair(
    row: Awaited<ReturnType<CodeReadAccess["repository"]>>,
    from: string | undefined,
    to: string,
  ): Promise<{ from?: string; to: string }> {
    const [a, b] = await Promise.all([
      from ? this.browser.revisionOf(row, from) : undefined,
      this.browser.revisionOf(row, to),
    ]);
    if ((from && !a) || !b) {
      throw new NotFoundError("No such revision in this repository.");
    }
    return { from: a?.sha, to: b.sha };
  }

  getCodeDiff = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/code/repos/:slug/diff",
    description:
      "The diff between two revisions, a page of files with the first files' hunks; `from` omitted diffs from the empty tree.",
    schema: {
      params: this.repoParams,
      query: z.object({
        from: z.text({ maxLength: 255 }).optional(),
        to: z.text({ maxLength: 255 }),
        page: z.integer().min(0).optional(),
      }),
      response: codeDiffSchema,
    },
    handler: async ({ params, query, user }) => {
      const row = await this.access.repository(
        params.projectId,
        params.slug,
        user,
      );
      const pair = await this.pair(row, query.from, query.to);
      return this.diffs.diff(row.backendRef, pair.from, pair.to, {
        page: query.page,
      });
    },
  });

  getCodeDiffFile = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/code/repos/:slug/diff/file",
    description: "One file's hunks in the diff between two revisions.",
    schema: {
      params: this.repoParams,
      query: z.object({
        from: z.text({ maxLength: 255 }).optional(),
        to: z.text({ maxLength: 255 }),
        path: z.text({ maxLength: 4096 }),
      }),
      response: codeDiffFileSchema,
    },
    handler: async ({ params, query, user }) => {
      const row = await this.access.repository(
        params.projectId,
        params.slug,
        user,
      );
      const pair = await this.pair(row, query.from, query.to);
      const file = await this.diffs.file(
        row.backendRef,
        pair.from,
        pair.to,
        query.path,
      );
      if (!file) throw new NotFoundError(`${query.path} is not in this diff.`);
      return file;
    },
  });

  /**
   * Lines of a blob, for the context a diff hides between two hunks.
   */
  getCodeBlobLines = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/code/repos/:slug/blobs/:sha/lines",
    description: "Lines start to end (1-based, inclusive) of a blob.",
    schema: {
      params: this.repoParams.extend({
        sha: z.text({ minLength: 40, maxLength: 40 }),
      }),
      query: z.object({
        start: z.integer().min(1),
        end: z.integer().min(1),
      }),
      response: z.object({ lines: z.array(z.string()) }),
    },
    handler: async ({ params, query, user }) => {
      const row = await this.access.repository(
        params.projectId,
        params.slug,
        user,
      );
      const lines = await this.diffs.lines(
        row.backendRef,
        params.sha,
        query.start,
        Math.min(query.end, query.start + 1000),
      );
      if (!lines) throw new NotFoundError("No such text blob.");
      return { lines };
    },
  });

  getCodeLog = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/code/repos/:slug/log",
    description:
      "A revision's history, optionally of one file or folder, a page of 30 newest first, each commit with its quests.",
    schema: {
      params: this.repoParams,
      query: codeLocationQuerySchema.extend({
        page: z.integer().min(0).optional(),
      }),
      response: codeLogSchema,
    },
    handler: async ({ params, query, user }) => {
      const row = await this.access.repository(
        params.projectId,
        params.slug,
        user,
      );
      const { page, ...location } = query;
      return this.browser.log(row, location, page);
    },
  });

  getCodeCommit = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/code/repos/:slug/commits/:sha",
    description:
      "One commit, by a full sha or a unique prefix: its message, author, committer, parents and quests.",
    schema: {
      params: this.repoParams.extend({
        sha: z.text({ minLength: 4, maxLength: 40 }),
      }),
      response: codeCommitDetailSchema,
    },
    handler: async ({ params, user }) => {
      const row = await this.access.repository(
        params.projectId,
        params.slug,
        user,
      );
      return this.browser.commitOf(row, params.sha);
    },
  });
}
