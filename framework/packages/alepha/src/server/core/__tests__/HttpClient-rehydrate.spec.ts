import { Alepha, AlephaError, z } from "alepha";
import { describe, expectTypeOf, it } from "vitest";

import {
  $action,
  type ActionErrors,
  HttpClient,
  HttpError,
  InternalServerError,
  NotFoundError,
  $route,
  ServerProvider,
} from "../index.ts";

const QuotaExceeded = HttpError.extend({
  name: "QUOTA_EXCEEDED",
  default: { status: 409 },
  schema: z.object({ limit: z.number(), used: z.number() }),
});

class Api {
  createProject = $action({
    method: "POST",
    path: "/createProject",
    errors: [QuotaExceeded, NotFoundError],
    handler: () => {
      throw new QuotaExceeded({ limit: 5, used: 6 }, { message: "Over quota" });
    },
  });

  findProject = $action({
    method: "POST",
    path: "/findProject",
    errors: [QuotaExceeded, NotFoundError],
    handler: () => {
      throw new NotFoundError("No such project");
    },
  });

  loose = $action({ method: "POST", path: "/loose", handler: () => "ok" });

  teapot = $route({
    path: "/teapot",
    handler: () => {
      throw new HttpError({ status: 418 }, { message: "I am a teapot" });
    },
  });

  forged = $route({
    path: "/forged",
    handler: ({ reply }) => {
      reply.setStatus(409);
      reply.setHeader("content-type", "application/json");
      return JSON.stringify({
        name: "QUOTA_EXCEEDED",
        status: 409,
        message: "Conflict",
        data: { limit: "five" },
      });
    },
  });
}

const start = async () => {
  const alepha = Alepha.create({ env: { SERVER_PORT: 0 } }).with(Api);
  await alepha.start();
  return {
    api: alepha.inject(Api),
    client: alepha.inject(HttpClient),
    hostname: alepha.inject(ServerProvider).hostname,
  };
};

const caught = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new AlephaError("expected a rejection");
};

describe("HttpClient error rehydration", () => {
  it("rebuilds an $error constant thrown on the server, data parsed", async ({
    expect,
  }) => {
    const { api } = await start();

    const error = await caught(() => api.createProject.fetch());
    expect(error).toBeInstanceOf(QuotaExceeded);
    expect(error).toBeInstanceOf(HttpError);
    if (!(error instanceof QuotaExceeded)) return;
    expect(error.status).toBe(409);
    expect(error.message).toBe("Over quota");
    expect(error.data).toMatchObject({ status: 409, limit: 5, used: 6 });
  });

  it("rebuilds a built-in class", async ({ expect }) => {
    const { api } = await start();

    const error = await caught(() => api.findProject.fetch());
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).message).toBe("No such project");
    expect((error as NotFoundError).status).toBe(404);
  });

  it("falls back to HttpError for an unknown code", async ({ expect }) => {
    const { client, hostname } = await start();

    const error = await caught(() => client.fetch(`${hostname}/teapot`));
    expect((error as Error).constructor).toBe(HttpError);
    expect((error as HttpError).status).toBe(418);
    expect((error as HttpError).message).toBe("I am a teapot");
  });

  it("falls back to HttpError when data fails the schema", async ({
    expect,
  }) => {
    const { client, hostname } = await start();

    const error = await caught(() => client.fetch(`${hostname}/forged`));
    expect(error).not.toBeInstanceOf(QuotaExceeded);
    expect((error as Error).constructor).toBe(HttpError);
    expect((error as HttpError).status).toBe(409);
    expect((error as HttpError).data).toEqual({ status: 409, limit: "five" });
  });

  it("types ActionErrors as the declared union plus InternalServerError", () => {
    const api = Alepha.create().with(Api).inject(Api);

    expectTypeOf<ActionErrors<typeof api.createProject>>().toEqualTypeOf<
      InstanceType<typeof QuotaExceeded> | NotFoundError
    >();
    // Its own member, though it collapses into NotFoundError above: two
    // HTTP errors with the same data have the same instance type.
    expectTypeOf<InternalServerError>().toExtend<
      ActionErrors<typeof api.createProject>
    >();
    expectTypeOf<ActionErrors<typeof api.loose>>().toEqualTypeOf<HttpError>();
  });
});
