import { Alepha } from "alepha";
import type { ServerRequest, ServerRoute } from "alepha/server";
import { MultipartCapProvider } from "alepha/server/multipart";
import { describe, it } from "vitest";
import { AlephaApiFiles } from "../index.ts";
import { $storage } from "../primitives/$storage.ts";

/**
 * Two buckets with different appetites, in one application.
 *
 * This is the shape the whole three-level design exists to make possible: a
 * release bucket that may take 100 MB sitting next to an avatar bucket that
 * must not, without either one deciding for the other.
 */
class Buckets {
  releases = $storage({ name: "releases", maxSize: 100 });
  avatars = $storage({ name: "avatars", maxSize: 5 });
  scratch = $storage({ name: "scratch" });
}

const uploadRoute = {
  path: "/api/files",
  method: "POST",
} as unknown as ServerRoute;

const requestFor = (bucket?: string): ServerRequest =>
  ({
    query: bucket ? { bucket } : {},
  }) as unknown as ServerRequest;

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaApiFiles);
  alepha.inject(Buckets);
  const caps = alepha.inject(MultipartCapProvider);
  await alepha.start();
  return caps;
};

describe("StorageMultipartCapProvider", () => {
  it("lets a bucket raise the ceiling far past the global default", async ({
    expect,
  }) => {
    const caps = await setup();

    const cap = caps.resolve(requestFor("releases"), uploadRoute);

    // 100 MB, declared in megabytes and answered in bytes — the one place the
    // two vocabularies meet.
    expect(cap?.maxFileBytes).toBe(100 * 1024 * 1024);
  });

  it("leaves a stricter bucket strict", async ({ expect }) => {
    const caps = await setup();

    const cap = caps.resolve(requestFor("avatars"), uploadRoute);

    expect(cap?.maxFileBytes).toBe(5 * 1024 * 1024);
  });

  it("answers a bucket's documented default when it declares no maxSize", async ({
    expect,
  }) => {
    const caps = await setup();

    // `$storage` documents `maxSize` as defaulting to 10 MB, and `FileService`
    // enforces exactly that. Deferring here instead meant the transport applied
    // the 5 MB application default, so an undeclared bucket was held at half
    // what its own documentation promised — and nothing said so.
    const cap = caps.resolve(requestFor("scratch"), uploadRoute);

    expect(cap?.maxFileBytes).toBe(10 * 1024 * 1024);
  });

  it("has no opinion when no bucket was named", async ({ expect }) => {
    const caps = await setup();

    expect(caps.resolve(requestFor(), uploadRoute)).toBeUndefined();
  });

  it("has no opinion about a bucket that does not exist", async ({
    expect,
  }) => {
    const caps = await setup();

    // The upload handler answers 404 for an unknown bucket with a message that
    // says so. Refusing here would only change which error the caller reads.
    expect(caps.resolve(requestFor("nope"), uploadRoute)).toBeUndefined();
  });

  /**
   * The refusal that keeps the query parameter from being a skeleton key.
   *
   * It is chosen by the caller, so a resolver that answered for every route
   * would let any request name the largest bucket the application declares and
   * claim its budget — on a route that never stores anything by bucket.
   */
  it("says nothing about a route it does not own", async ({ expect }) => {
    const caps = await setup();

    const elsewhere = {
      path: "/api/campaigns/:id/comments",
      method: "POST",
    } as ServerRoute;

    expect(caps.resolve(requestFor("releases"), elsewhere)).toBeUndefined();
  });

  it("says nothing about an application route that merely ends in /files", async ({
    expect,
  }) => {
    const caps = await setup();

    // A suffix is not an identity. This route stores nothing by bucket, so
    // answering for it would hand any caller the largest budget the app
    // declares anywhere — and on a `z.file()` route that budget is memory,
    // spent before `$secure` has run.
    const theirs = {
      path: "/api/projects/:id/files",
      method: "POST",
    } as ServerRoute;

    expect(caps.resolve(requestFor("releases"), theirs)).toBeUndefined();
  });

  it("says nothing about a different method on the same path", async ({
    expect,
  }) => {
    const caps = await setup();

    // `GET /api/files` is the listing. It carries no body, so a size budget is
    // meaningless there — and granting one is free surface.
    const listing = { path: "/api/files", method: "GET" } as ServerRoute;

    expect(caps.resolve(requestFor("releases"), listing)).toBeUndefined();
  });
});
