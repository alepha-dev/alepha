import { $inject, Alepha, AlephaError, TimeoutError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  $secure,
  AlephaSecurity,
  JwtProvider,
  SecurityProvider,
} from "alepha/security";
import { describe, it } from "vitest";

import {
  $action,
  HttpClient,
  HttpError,
  ServerProvider,
  serverApiOptions,
} from "../index.ts";

/**
 * What the handlers saw, for the assertions: the outbound call's error, and
 * a promise per handler resolved once it started.
 */
class Probe {
  outbound?: unknown;
  outboundSettled?: Promise<void>;
  started = new Map<string, () => void>();
  ready = new Map<string, Promise<void>>();

  expect(name: string): void {
    this.ready.set(
      name,
      new Promise((resolve) => this.started.set(name, resolve)),
    );
  }

  start(name: string): void {
    this.started.get(name)?.();
  }
}

class Api {
  protected readonly alepha = $inject(Alepha);
  protected readonly http = $inject(HttpClient);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly probe = $inject(Probe);

  /**
   * Answers once its client goes away, never before.
   */
  hang = $action({
    method: "GET",
    path: "/hang",
    handler: async () => {
      const signal = this.alepha.context.signal;
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      return "late";
    },
  });

  slow = $action({
    method: "POST",
    path: "/slow",
    timeout: [5, "seconds"],
    handler: async () => {
      const hostname = this.alepha.inject(ServerProvider).hostname;
      const call = this.http.fetch(`${hostname}/api/hang`);
      this.probe.outboundSettled = call.then(
        () => undefined,
        (error: unknown) => {
          this.probe.outbound = error;
        },
      );
      this.probe.start("slow");
      await call;
      return "done";
    },
  });

  stubborn = $action({
    method: "POST",
    path: "/stubborn",
    timeout: 1500,
    handler: async () => {
      this.probe.start("stubborn");
      // Ignores its signal: the caller is answered at the deadline anyway.
      await this.dateTime.wait([1, "hours"]);
      return "done";
    },
  });

  defaulted = $action({
    method: "POST",
    path: "/defaulted",
    handler: async () => {
      this.probe.start("defaulted");
      await this.dateTime.wait([1, "hours"], {
        signal: this.alepha.context.signal,
      });
      this.alepha.context.signal.throwIfAborted();
      return "done";
    },
  });

  optedOut = $action({
    method: "POST",
    path: "/optedOut",
    timeout: false,
    handler: async () => {
      this.probe.start("optedOut");
      await this.dateTime.wait([10, "seconds"], {
        signal: this.alepha.context.signal,
      });
      this.alepha.context.signal.throwIfAborted();
      return "done";
    },
  });

  innerStrict = $action({
    method: "POST",
    path: "/innerStrict",
    errors: [],
    handler: async () => {
      // An outbound call's own deadline, not the action's.
      throw new TimeoutError({ timeout: 30_000 });
    },
  });

  guarded = $action({
    method: "POST",
    path: "/guarded",
    use: [$secure()],
    timeout: [1, "minutes"],
    schema: { response: z.object({ user: z.text() }) },
    handler: async (request) => ({ user: request.user.id }),
  });
}

const start = async (options: { timeout?: number } = {}) => {
  const alepha = Alepha.create().with(AlephaSecurity).with(Api);
  if (options.timeout !== undefined) {
    alepha.store.mut(serverApiOptions, (o) => ({
      ...o,
      timeout: options.timeout,
    }));
  }
  await alepha.start();
  const api = alepha.inject(Api);
  const probe = alepha.inject(Probe);
  const dateTime = alepha.inject(DateTimeProvider);
  dateTime.pause();
  const hostname = alepha.inject(ServerProvider).hostname;
  const call = async (name: string, init?: RequestInit) => {
    const response = await fetch(`${hostname}/api/${name}`, {
      method: "POST",
      ...init,
    });
    return { status: response.status, body: await response.text() };
  };
  /**
   * Call an action over HTTP, wait for its handler to start, then travel.
   */
  const callPast = async (name: string, travel: number) => {
    probe.expect(name);
    const pending = call(name);
    await probe.ready.get(name);
    await dateTime.travel(travel);
    return pending;
  };
  return { alepha, api, probe, call, callPast };
};

const caught = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new AlephaError("expected a rejection");
};

describe("$action timeout", () => {
  describe("over HTTP", () => {
    it("answers 503 TIMEOUT under travel(), and aborts the handler's outbound fetch", async ({
      expect,
    }) => {
      const { probe, callPast } = await start();

      const http = await callPast("slow", 5_000);

      expect(http.status).toBe(503);
      expect(JSON.parse(http.body)).toMatchObject({
        name: "TIMEOUT",
        message: "Timed out after 5 s",
        data: { status: 503, timeout: 5_000 },
      });
      await probe.outboundSettled;
      expect(probe.outbound).toBeInstanceOf(TimeoutError);
    });

    it("answers at the deadline even when the handler ignores its signal", async ({
      expect,
    }) => {
      const { callPast } = await start();

      const http = await callPast("stubborn", 1_500);

      expect(http.status).toBe(503);
      expect(JSON.parse(http.body)).toMatchObject({
        name: "TIMEOUT",
        message: "Timed out after 1500 ms",
      });
    });

    it("applies the serverApiOptions default to an action without its own", async ({
      expect,
    }) => {
      const { callPast } = await start({ timeout: 2_000 });

      const http = await callPast("defaulted", 2_000);

      expect(http.status).toBe(503);
      expect(JSON.parse(http.body)).toMatchObject({
        data: { timeout: 2_000 },
      });
    });

    it("has no default: an action without a timeout is never cut", async ({
      expect,
    }) => {
      const { api } = await start();
      expect(api.defaulted.timeout).toBeUndefined();
    });

    it("lets timeout: false opt out of the default", async ({ expect }) => {
      const { api, callPast } = await start({ timeout: 2_000 });

      expect(api.optedOut.timeout).toBeUndefined();
      const http = await callPast("optedOut", 10_000);

      expect(http.status).toBe(200);
    });

    it("passes an inner TimeoutError through strict mode as 503", async ({
      expect,
    }) => {
      const { call } = await start();

      const http = await call("innerStrict");

      expect(http.status).toBe(503);
      expect(JSON.parse(http.body)).toMatchObject({ name: "TIMEOUT" });
    });

    it("runs the use middlewares inside the deadline, and the handler sees what they resolved", async ({
      expect,
    }) => {
      const { alepha, call } = await start();
      const realm = alepha.inject(SecurityProvider).getRealms()[0]?.name;
      const jwt = alepha.inject(JwtProvider);
      const token = await jwt.create({ sub: "u1", roles: [] }, realm, {
        header: { typ: jwt.accessTokenTyp },
      });

      const http = await call("guarded", {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(http.status).toBe(200);
      expect(JSON.parse(http.body)).toEqual({ user: "u1" });
    });
  });

  describe("locally", () => {
    it("rejects run() with the TimeoutError", async ({ expect }) => {
      const { alepha, api, probe } = await start();
      const dateTime = alepha.inject(DateTimeProvider);

      probe.expect("stubborn");
      const pending = caught(() => api.stubborn());
      await probe.ready.get("stubborn");
      await dateTime.travel(1_500);

      const error = await pending;
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).status).toBe(503);
    });
  });

  describe("typing", () => {
    it("a TimeoutError is not an HttpError, but carries its status", ({
      expect,
    }) => {
      const error = new TimeoutError({ timeout: 1_000 });
      expect(error).not.toBeInstanceOf(HttpError);
      expect(error.status).toBe(503);
    });
  });
});
