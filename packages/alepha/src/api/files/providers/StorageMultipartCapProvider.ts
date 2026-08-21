import { $hook, $inject } from "alepha";
import { $logger } from "alepha/logger";
import type { ServerRequest, ServerRoute } from "alepha/server";
import {
  type MultipartCap,
  MultipartCapProvider,
} from "alepha/server/multipart";

import { FileController } from "../controllers/FileController.ts";
import { FileService } from "../services/FileService.ts";

/**
 * Lets the targeted `$storage` decide how many bytes a request may carry.
 *
 * This is what makes `$storage({ maxSize })` mean what it says. Before, the
 * declaration could only ever tighten an application-wide ceiling it knew
 * nothing about, so a bucket asking for 100 MB was silently held at 5 - a
 * promise the framework could not keep, and one nothing reported.
 *
 * The bucket is known **before** the body is read, because it arrives in the
 * URL. That is the whole reason a per-destination budget is possible at all:
 * by the time the first byte lands, where it is going has already been decided.
 */
export class StorageMultipartCapProvider {
  protected readonly files = $inject(FileService);
  protected readonly controller = $inject(FileController);
  protected readonly caps = $inject(MultipartCapProvider);
  protected readonly log = $logger();

  /**
   * Joins the registry rather than replacing it.
   *
   * Substituting `MultipartCapProvider` was the first attempt and it cannot
   * work: the server resolves it while registering, and this module usually
   * loads afterwards — the container refuses the late substitution, loudly and
   * correctly. Adding a resolver has no such ordering constraint.
   */
  public readonly register = $hook({
    on: "configure",
    handler: () => {
      this.caps.use((request, route) => this.resolve(request, route));
    },
  });

  /**
   * The query parameter carrying the destination.
   *
   * Matches what `FileController.uploadFile` reads, so the budget and the
   * bucket cannot disagree — a request whose bytes are checked against one
   * bucket and stored in another is a bug that only shows up at the size
   * boundary, which is the worst place to find one.
   */
  protected static readonly BUCKET_PARAM = "bucket";

  /**
   * Answers only for the framework's own upload route.
   *
   * ⚠️ Deliberately narrow. This resolver keys on a query parameter, which the
   * caller controls: answering for every route would let any request name the
   * largest bucket the application declares and claim its budget. Scoping to
   * the route that actually stores by bucket keeps the parameter meaningful
   * where it is honoured and inert everywhere else.
   */
  public resolve(
    request: ServerRequest,
    route: ServerRoute,
  ): MultipartCap | undefined {
    if (!this.owns(route)) {
      return undefined;
    }

    const name = this.bucketOf(request);
    if (!name) {
      return undefined;
    }

    try {
      // `storage.maxSize`, not `options.maxSize`: the declared value *or* the
      // documented default. Reading the raw option meant an undeclared bucket
      // answered nothing and fell through to the application-wide ceiling —
      // half of what `$storage` promises, and silently.
      const { maxSize } = this.files.storage(name);
      // `$storage` speaks megabytes — it is a declaration a human writes — and
      // everything below this line speaks bytes. One conversion, in the one
      // place that bridges the two vocabularies.
      return { maxFileBytes: maxSize * 1024 * 1024 };
    } catch {
      // An unknown bucket is not this provider's refusal to make: the upload
      // handler answers 404 for it with a message that says so. Deciding a
      // budget here would only change *which* error the caller sees.
      return undefined;
    }
  }

  /**
   * Whether this route is the upload action, and not merely shaped like it.
   *
   * Asked of the action itself — its method and its resolved path, prefix
   * included — rather than of the path's spelling. `endsWith("/files")` was the
   * first answer and it claimed routes this provider has no business claiming:
   * any application's `POST /api/projects/:id/files` matched, and so did the
   * listing on `GET /api/files`. On a `z.file()` route that mistake is not
   * cosmetic — the granted budget is memory, spent before `$secure` runs.
   *
   * Reading it from the action also means a change of URL cannot leave the two
   * disagreeing, which a literal here would have allowed.
   */
  protected owns(route: ServerRoute): boolean {
    const upload = this.controller.uploadFile.route;
    return route.method === upload.method && route.path === upload.path;
  }

  protected bucketOf(request: ServerRequest): string | undefined {
    const value = (request.query as Record<string, unknown> | undefined)?.[
      StorageMultipartCapProvider.BUCKET_PARAM
    ];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
}
