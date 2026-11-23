import { ProjectLimits } from "@lore/core/api";
import { $inject, type StreamLike, z } from "alepha";
import { $logger } from "alepha/logger";
import { $route, type ServerRequest } from "alepha/server";

import { GitBackend, type GitService } from "../backends/GitBackend.ts";
import { CodePushRecorder } from "../services/CodePushRecorder.ts";
import { GitAccessService } from "../services/GitAccessService.ts";
import { GitReceivePack } from "../services/GitReceivePack.ts";

/**
 * git smart HTTP on `.git` URLs (#Q3932): `git clone
 * https://lore.alepha.app/<project>/<repo>.git`, and `/<project>.git` for the
 * repository named like its project.
 *
 * ## Six routes with static tails
 *
 * Alepha's router knows whole-segment static parts, `:param` and a trailing
 * `*`, so `/:project.git/*` would be one param named `project.git` matching
 * everything. Instead: the three smart HTTP endpoints under one param
 * (`/:repo/...`) and under two (`/:project/:repo/...`), each answering 404
 * unless the last param ends in `.git`. A static tail outranks a page's
 * param, so `/<project>/<repo>.git/info/refs` never reaches a page, and
 * nothing else in Lore ends in `info/refs` or `git-*-pack`.
 *
 * No route declares a body schema, so the body parser leaves the stream
 * alone and a pack goes through without being read into memory.
 */
export class GitHttpController {
  protected readonly log = $logger();
  protected readonly access = $inject(GitAccessService);
  protected readonly backend = $inject(GitBackend);
  protected readonly receivePack = $inject(GitReceivePack);
  protected readonly limits = $inject(ProjectLimits);
  protected readonly pushes = $inject(CodePushRecorder);

  /**
   * What `Git-Protocol` may say: `version=2`, and the `key=value` list git
   * may grow. Anything else is dropped, never forwarded to a child's env.
   */
  protected static readonly GIT_PROTOCOL = /^[A-Za-z0-9=:.,_-]{1,128}$/;

  protected static readonly SERVICES: ReadonlySet<string> = new Set([
    "git-upload-pack",
    "git-receive-pack",
  ]);

  protected readonly schema = {
    one: z.object({ repo: z.string().max(200) }),
    two: z.object({ project: z.string().max(200), repo: z.string().max(200) }),
    service: z.object({ service: z.string().max(40).optional() }),
  };

  gitInfoRefs = $route({
    method: "GET",
    path: "/:repo/info/refs",
    schema: { params: this.schema.one, query: this.schema.service },
    handler: (request) =>
      this.handle(request, this.short(request.params.repo), {
        service: request.query.service,
        advertise: true,
      }),
  });

  gitUploadPack = $route({
    method: "POST",
    path: "/:repo/git-upload-pack",
    schema: { params: this.schema.one },
    handler: (request) =>
      this.handle(request, this.short(request.params.repo), {
        service: "git-upload-pack",
        advertise: false,
      }),
  });

  gitReceivePack = $route({
    method: "POST",
    path: "/:repo/git-receive-pack",
    schema: { params: this.schema.one },
    handler: (request) =>
      this.handle(request, this.short(request.params.repo), {
        service: "git-receive-pack",
        advertise: false,
      }),
  });

  gitProjectInfoRefs = $route({
    method: "GET",
    path: "/:project/:repo/info/refs",
    schema: { params: this.schema.two, query: this.schema.service },
    handler: (request) =>
      this.handle(
        request,
        this.long(request.params.project, request.params.repo),
        { service: request.query.service, advertise: true },
      ),
  });

  gitProjectUploadPack = $route({
    method: "POST",
    path: "/:project/:repo/git-upload-pack",
    schema: { params: this.schema.two },
    handler: (request) =>
      this.handle(
        request,
        this.long(request.params.project, request.params.repo),
        { service: "git-upload-pack", advertise: false },
      ),
  });

  gitProjectReceivePack = $route({
    method: "POST",
    path: "/:project/:repo/git-receive-pack",
    schema: { params: this.schema.two },
    handler: (request) =>
      this.handle(
        request,
        this.long(request.params.project, request.params.repo),
        { service: "git-receive-pack", advertise: false },
      ),
  });

  /**
   * `/<project>.git`: the repository named like its project.
   */
  protected short(segment: string) {
    const slug = this.stripGit(segment);
    return slug ? { projectSlug: slug, repoSlug: slug } : undefined;
  }

  /**
   * `/<project>/<repo>.git`.
   */
  protected long(project: string, segment: string) {
    const slug = this.stripGit(segment);
    return slug ? { projectSlug: project, repoSlug: slug } : undefined;
  }

  protected stripGit(segment: string): string | undefined {
    return segment.endsWith(".git") && segment.length > 4
      ? segment.slice(0, -4)
      : undefined;
  }

  protected async handle(
    request: ServerRequest<any>,
    target: { projectSlug: string; repoSlug: string } | undefined,
    call: { service?: string; advertise: boolean },
  ): Promise<string | StreamLike> {
    const { reply } = request;
    const headers = request.headers as Record<string, string | undefined>;
    if (
      !target ||
      !call.service ||
      !GitHttpController.SERVICES.has(call.service)
    ) {
      // Not a `.git` URL, or the dumb protocol: nothing Lore serves.
      return this.text(reply, 404, "Not found");
    }
    const service = call.service as GitService;
    const decision = await this.access.authorize({
      authorization: headers.authorization,
      url: request.url,
      projectSlug: target.projectSlug,
      repoSlug: target.repoSlug,
      service,
    });
    if (!decision.allowed) {
      if (decision.status === 401) {
        reply.setHeader(
          "www-authenticate",
          'Basic realm="Lore", charset="UTF-8"',
        );
      }
      return this.text(reply, decision.status, decision.message);
    }
    const repository = decision.repository;
    const protocol = String(headers["git-protocol"] ?? "");
    let body = call.advertise ? undefined : this.bodyOf(request);
    let push: Parameters<CodePushRecorder["watch"]>[1] | undefined;

    if (service === "git-receive-pack" && body) {
      const inspected = await this.receivePack.inspect(body);
      body = inspected.body;
      // Recorded once the backend's answer has streamed (#Q3945); an import
      // (`lore-import`, #Q3935) links no commit to a quest.
      push = {
        repository,
        repoPath: `${target.projectSlug}/${repository.slug}`,
        user: decision.user,
        commands: inspected.commands,
        capabilities: inspected.capabilities,
        pushOptions: inspected.pushOptions,
      };
      const refusal = await this.refusalOf(
        repository.backendRef,
        repository.defaultBranch,
        inspected.commands,
      );
      if (refusal) {
        await this.drain(body);
        const report = this.receivePack.refusal(
          inspected.commands,
          inspected.capabilities,
          refusal,
        );
        reply.setHeader("cache-control", "no-cache");
        if (!report) return this.text(reply, 403, refusal);
        reply.setStatus(200);
        reply.setHeader(
          "content-type",
          "application/x-git-receive-pack-result",
        );
        return new Response(report as BodyInit).body as StreamLike;
      }
    }

    const response = await this.backend.serve(repository.backendRef, {
      service,
      advertise: call.advertise,
      body,
      gitProtocol: GitHttpController.GIT_PROTOCOL.test(protocol)
        ? protocol
        : undefined,
      userAgent: headers["user-agent"] || undefined,
      defaultBranch: repository.defaultBranch,
      signal: request.signal,
    });
    reply.setStatus(response.status);
    if (response.contentType) {
      reply.setHeader("content-type", response.contentType);
    }
    reply.setHeader("cache-control", "no-cache, max-age=0, must-revalidate");
    if (
      call.advertise &&
      service === "git-receive-pack" &&
      response.status === 200 &&
      typeof response.body !== "string"
    ) {
      return this.receivePack.advertisePushOptions(response.body) as StreamLike;
    }
    if (push && response.status === 200 && typeof response.body !== "string") {
      return this.pushes.watch(response.body, push) as StreamLike;
    }
    return response.body as string | StreamLike;
  }

  /**
   * Why a push is refused before the backend sees it, or undefined.
   */
  protected async refusalOf(
    ref: string,
    defaultBranch: string,
    commands: Array<{ newId: string; ref: string }>,
  ): Promise<string | undefined> {
    const head = `refs/heads/${defaultBranch}`;
    if (
      commands.some(
        (command) =>
          command.ref === head && command.newId === GitReceivePack.ZERO,
      )
    ) {
      return `the default branch ${defaultBranch} cannot be deleted`;
    }
    const info = await this.backend.info(ref);
    const max = await this.limits.maxRepositorySizeBytes();
    if (info?.sizeBytes !== undefined && info.sizeBytes > max) {
      return `the repository is over its size cap (${Math.round(max / 1024 / 1024)} MiB)`;
    }
    return undefined;
  }

  /**
   * The request body as a web stream, inflated when git gzipped it.
   */
  protected bodyOf(
    request: ServerRequest<any>,
  ): ReadableStream<Uint8Array> | undefined {
    let stream: ReadableStream<Uint8Array> | undefined;
    if (request.raw?.web?.req) {
      stream = request.raw.web.req.body ?? undefined;
    } else if (request.raw?.node?.req) {
      stream = (
        ReadableStream as unknown as {
          from(iterable: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array>;
        }
      ).from(request.raw.node.req as AsyncIterable<Uint8Array>);
    }
    if (!stream) return undefined;
    const headers = request.headers as Record<string, string | undefined>;
    const encoding = String(headers["content-encoding"] ?? "");
    if (/gzip/i.test(encoding)) {
      return stream.pipeThrough(
        new DecompressionStream("gzip") as unknown as ReadableWritablePair<
          Uint8Array,
          Uint8Array
        >,
      );
    }
    return stream;
  }

  /**
   * Read a body to its end, so a refused push's pack is consumed before the
   * answer and the connection stays usable.
   */
  protected async drain(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  }

  protected text(
    reply: ServerRequest["reply"],
    status: number,
    message: string,
  ) {
    reply.setStatus(status);
    reply.setHeader("content-type", "text/plain; charset=utf-8");
    return `${message}\n`;
  }
}
