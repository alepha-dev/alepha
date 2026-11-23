import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";
import { FileSystemProvider } from "alepha/system";

import { codeFileSchema } from "../schemas/codeFileSchema.ts";
import { codeLocationQuerySchema } from "../schemas/codeLocationQuerySchema.ts";
import { codeRepositoryDetailSchema } from "../schemas/codeRepositoryDetailSchema.ts";
import { codeRepositorySlugSchema } from "../schemas/codeRepositorySlugSchema.ts";
import { codeTreeCommitsSchema } from "../schemas/codeTreeCommitsSchema.ts";
import { codeTreeSchema } from "../schemas/codeTreeSchema.ts";
import { CodeBrowserService } from "../services/CodeBrowserService.ts";
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
}
