import { $pipeline, Alepha, AlephaError } from "alepha";
import {
  ActorContentionError,
  ActorProvider,
  type ActorRequest,
} from "alepha/actor";
import { $rateLimit } from "alepha/rate-limit";
import { $action, HttpError, type ServerRequest } from "alepha/server";
import { describe, it } from "vitest";

const fakeRequest = (ip = "127.0.0.1"): ServerRequest => {
  const headers: Record<string, string> = {};
  return {
    ip,
    headers: {},
    method: "GET",
    url: "/test",
    path: "/test",
    query: {},
    params: {},
    body: undefined,
    reply: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      _headers: headers,
    },
  } as any;
};

const inRequest = <T>(
  alepha: Alepha,
  request: ServerRequest,
  fn: () => Promise<T>,
): Promise<T> =>
  alepha.context.run(async () => {
    alepha.set("alepha.http.request", request);
    return fn();
  });

class BrokenActorProvider extends ActorProvider {
  public error: Error = new AlephaError("actor store down");
  public override async execute(_request: ActorRequest): Promise<unknown> {
    throw this.error;
  }
}

class Service {
  two = $rateLimit({ name: "mw:two", limit: 2, window: 60_000 });
  five = $rateLimit({ name: "mw:five", limit: 5, window: 60_000 });
  perUser = $rateLimit({ name: "mw:user", limit: 1, window: 60_000 });
  failures = $rateLimit({ name: "mw:failures", limit: 2, window: 60_000 });
  successes = $rateLimit({ name: "mw:successes", limit: 2, window: 60_000 });
  lenient = $rateLimit({
    name: "mw:lenient",
    limit: 1,
    window: 60_000,
    onStoreError: "allow",
  });

  limited = $pipeline({
    use: [this.two.middleware()],
    handler: async () => "ok",
  });
  headers = $pipeline({
    use: [this.five.middleware()],
    handler: async (a: number, b: number) => a + b,
  });
  byUser = $pipeline({
    use: [this.perUser.middleware({ key: (id: string) => `user:${id}` })],
    handler: async (id: string) => `ok:${id}`,
  });
  login = $pipeline({
    use: [this.failures.middleware({ skipSuccessfulRequests: true })],
    handler: async (ok: boolean) => {
      if (!ok)
        throw new HttpError({ status: 401 }, { message: "Unauthorized" });
      return "ok";
    },
  });
  upload = $pipeline({
    use: [this.successes.middleware({ skipFailedRequests: true })],
    handler: async (ok: boolean) => {
      if (!ok) throw new AlephaError("crashed");
      return "ok";
    },
  });
  open = $pipeline({
    use: [this.lenient.middleware()],
    handler: async () => "open",
  });
  action = $action({
    path: "/action",
    method: "GET",
    use: [this.two.middleware()],
    handler: () => "done",
  });
}

const boot = async (alepha = Alepha.create()) => {
  const service = alepha.inject(Service);
  await alepha.start();
  return { alepha, service };
};

describe("$rateLimit middleware", () => {
  it("allows calls within the limit and answers 429 past it", async ({
    expect,
  }) => {
    const { alepha, service } = await boot();
    await inRequest(alepha, fakeRequest(), async () => {
      expect(await service.limited()).toBe("ok");
      expect(await service.limited()).toBe("ok");
      const error = await service.limited().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(429);
    });
  });

  it("keys on the request ip, one bucket per address", async ({ expect }) => {
    const { alepha, service } = await boot();
    for (const ip of ["10.0.0.1", "10.0.0.2"])
      await inRequest(alepha, fakeRequest(ip), async () => {
        expect(await service.limited()).toBe("ok");
        expect(await service.limited()).toBe("ok");
        await expect(service.limited()).rejects.toThrow("Too Many Requests");
      });
  });

  it("falls back to one global bucket without a request", async ({
    expect,
  }) => {
    const { service } = await boot();
    expect(await service.limited()).toBe("ok");
    expect(await service.limited()).toBe("ok");
    await expect(service.limited()).rejects.toThrow("Too Many Requests");
  });

  it("uses the key function over the handler arguments", async ({ expect }) => {
    const { service } = await boot();
    expect(await service.byUser("a")).toBe("ok:a");
    expect(await service.byUser("b")).toBe("ok:b");
    await expect(service.byUser("a")).rejects.toThrow("Too Many Requests");
  });

  it("sets limit headers when allowed, and Retry-After when refused", async ({
    expect,
  }) => {
    const { alepha, service } = await boot();
    const request = fakeRequest();
    const headers = (request.reply as any)._headers;
    await inRequest(alepha, request, async () => {
      expect(await service.headers(3, 4)).toBe(7);
      expect(headers["X-RateLimit-Limit"]).toBe("5");
      expect(headers["X-RateLimit-Remaining"]).toBe("4");
      expect(Number(headers["X-RateLimit-Reset"])).toBeGreaterThan(0);
      for (let i = 0; i < 4; i++) await service.headers(1, 1);
      await expect(service.headers(1, 1)).rejects.toThrow();
      expect(headers["X-RateLimit-Remaining"]).toBe("0");
      expect(headers["Retry-After"]).toBe("60");
    });
  });

  it("counts concurrent calls atomically", async ({ expect }) => {
    const { alepha, service } = await boot();
    const outcomes = await inRequest(alepha, fakeRequest(), () =>
      Promise.all(
        Array.from({ length: 10 }, () =>
          service.headers(0, 0).then(
            () => "ok",
            () => "refused",
          ),
        ),
      ),
    );
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(5);
  });

  it("refunds successes with skipSuccessfulRequests", async ({ expect }) => {
    const { service } = await boot();
    for (let i = 0; i < 5; i++) expect(await service.login(true)).toBe("ok");
    await expect(service.login(false)).rejects.toThrow("Unauthorized");
    await expect(service.login(false)).rejects.toThrow("Unauthorized");
    await expect(service.login(true)).rejects.toThrow("Too Many Requests");
  });

  it("refunds failures with skipFailedRequests", async ({ expect }) => {
    const { service } = await boot();
    for (let i = 0; i < 5; i++)
      await expect(service.upload(false)).rejects.toThrow("crashed");
    expect(await service.upload(true)).toBe("ok");
    expect(await service.upload(true)).toBe("ok");
    await expect(service.upload(true)).rejects.toThrow("Too Many Requests");
  });

  it("answers 503 on a store error and 429 on contention, without limit headers", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: ActorProvider,
      use: BrokenActorProvider,
    });
    const { service } = await boot(alepha);
    const request = fakeRequest();
    const headers = (request.reply as any)._headers;
    await inRequest(alepha, request, async () => {
      const outage = await service.limited().catch((e: unknown) => e);
      expect((outage as HttpError).status).toBe(503);
      expect(headers["X-RateLimit-Limit"]).toBeUndefined();
      alepha.inject(BrokenActorProvider).error = new ActorContentionError(
        "contended",
      );
      const contended = await service.limited().catch((e: unknown) => e);
      expect((contended as HttpError).status).toBe(429);
      expect(headers["Retry-After"]).toBe("1");
    });
  });

  it("lets the call through uncounted on a store error under allow", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: ActorProvider,
      use: BrokenActorProvider,
    });
    const { service } = await boot(alepha);
    const request = fakeRequest();
    await inRequest(alepha, request, async () => {
      expect(await service.open()).toBe("open");
      expect(await service.open()).toBe("open");
      expect((request.reply as any)._headers["X-RateLimit-Limit"]).toBe(
        undefined,
      );
    });
  });

  it("limits an $action through use", async ({ expect }) => {
    const { alepha, service } = await boot();
    await inRequest(alepha, fakeRequest("10.0.0.9"), async () => {
      expect(await service.action.run({})).toBe("done");
      expect(await service.action.run({})).toBe("done");
      await expect(service.action.run({})).rejects.toThrow("Too Many Requests");
    });
  });

  it("carries middleware metadata", ({ expect }) => {
    const service = Alepha.create().inject(Service);
    expect(service.limited.middlewares).toHaveLength(1);
    expect(service.limited.middlewares[0].name).toBe("$rateLimit");
  });
});
