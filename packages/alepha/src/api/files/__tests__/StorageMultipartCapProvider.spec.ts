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
}

const uploadRoute = { path: "/api/files" } as unknown as ServerRoute;

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

    const elsewhere = { path: "/api/campaigns/:id/comments" } as ServerRoute;

    expect(caps.resolve(requestFor("releases"), elsewhere)).toBeUndefined();
  });
});
