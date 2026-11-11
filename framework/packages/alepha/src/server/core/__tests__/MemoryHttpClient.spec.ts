import { $inject, Alepha, AlephaError, TimeoutError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import {
  $action,
  AlephaServer,
  HttpClient,
  HttpError,
  MemoryHttpClient,
  ServerProvider,
} from "../index.ts";

/**
 * The HttpClient test double (#Q3325): external calls answered by route,
 * recorded, unmatched ones refused, and everything above the transport
 * (timeout, error mapping, schema decoding) running for real.
 */
describe("MemoryHttpClient", () => {
  const API = "https://api.example.com";

  const customerSchema = z.object({ id: z.text(), name: z.text() });

  class Customers {
    http = $inject(HttpClient);

    get(id: string) {
      return this.http.fetch(`${API}/customers/${id}?expand=orders`, {
        schema: { response: customerSchema },
      });
    }

    create(name: string) {
      return this.http.fetch(`${API}/customers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
    }
  }

  const create = () => {
    const alepha = Alepha.create()
      .with({ provide: HttpClient, use: MemoryHttpClient })
      .with(Customers);
    return {
      alepha,
      http: alepha.inject(MemoryHttpClient),
      customers: alepha.inject(Customers),
    };
  };

  it("is the container's HttpClient once substituted", ({ expect }) => {
    const { alepha, http } = create();
    expect(alepha.inject(HttpClient)).toBe(http);
  });

  it("answers by method and URL pattern, with params, and decodes through the schema", async ({
    expect,
  }) => {
    const { http, customers } = create();
    http.on("GET", `${API}/customers/:id`, ({ params }) => ({
      id: params.id,
      name: "Ada",
      extra: "dropped by the schema",
    }));

    const response = await customers.get("c1");

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ id: "c1", name: "Ada" });
  });

  it("records each call with method, URL, params, query, headers and body", async ({
    expect,
  }) => {
    const { http, customers } = create();
    http.on("GET", `${API}/customers/:id`, ({ params }) => ({
      id: params.id,
      name: "Ada",
    }));
    http.on("POST", `${API}/customers`, () => ({ id: "c2" }), {
      status: 201,
    });

    await customers.get("c1");
    const created = await customers.create("Grace");

    expect(created.status).toBe(201);
    expect(http.calls()).toHaveLength(2);
    expect(http.calls("GET", `${API}/customers/:id`)).toHaveLength(1);
    expect(http.wasCalled("POST", `${API}/customers`)).toBe(true);

    const [get] = http.calls("GET", `${API}/customers/:id`);
    expect(get).toMatchObject({
      method: "GET",
      url: `${API}/customers/c1?expand=orders`,
      params: { id: "c1" },
      query: { expand: "orders" },
      matched: true,
    });
    const [post] = http.calls("POST", `${API}/customers`);
    expect(post.body).toEqual({ name: "Grace" });
    expect(post.headers["content-type"]).toBe("application/json");
  });

  it("lets the latest route win, matches a trailing * and any method with *", async ({
    expect,
  }) => {
    const { http } = create();
    http.on("*", `${API}/*`, () => "fallback");
    http.on("GET", `${API}/a/b`, () => "first");
    http.on("GET", `${API}/a/b`, () => "second");

    expect((await http.fetch(`${API}/a/b`)).data).toBe("second");
    expect((await http.fetch(`${API}/x/y/z`, { method: "DELETE" })).data).toBe(
      "fallback",
    );
  });

  it("rejects an unmatched call to another origin, naming method and URL, and records it", async ({
    expect,
  }) => {
    const { http, customers } = create();

    await expect(customers.get("c1")).rejects.toThrow(
      `MemoryHttpClient: no route for GET ${API}/customers/c1?expand=orders`,
    );
    await expect(customers.get("c1")).rejects.toBeInstanceOf(AlephaError);
    expect(http.recorded[0].matched).toBe(false);
  });

  it("maps an error status through HttpClient's own error mapping", async ({
    expect,
  }) => {
    const { http, customers } = create();
    http.on("GET", `${API}/customers/:id`, () => ({ error: "not_found" }), {
      status: 404,
    });

    const error = await customers.get("nope").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    expect((error as HttpError).message).toBe("not_found");
  });

  it("takes a full Response from a handler", async ({ expect }) => {
    const { http } = create();
    http.on(
      "GET",
      `${API}/teapot`,
      () =>
        new Response("short and stout", {
          status: 418,
          headers: { "content-type": "text/plain" },
        }),
    );

    const error = await http.fetch(`${API}/teapot`).catch((e: unknown) => e);

    expect((error as HttpError).status).toBe(418);
    expect((error as HttpError).message).toBe("short and stout");
  });

  it("fails as a network error when the handler throws", async ({ expect }) => {
    const { http } = create();
    http.on("GET", `${API}/down`, () => {
      throw new TypeError("fetch failed");
    });

    await expect(http.fetch(`${API}/down`)).rejects.toThrow("fetch failed");
  });

  it("simulates latency on the clock, and HttpClient's own timeout fires against it", async ({
    expect,
  }) => {
    const { alepha, http } = create();
    await alepha.start();
    const time = alepha.inject(DateTimeProvider);
    time.pause();
    http.on("GET", `${API}/slow`, () => ({ ok: true }), {
      delay: [5, "seconds"],
    });

    const slow = http
      .fetch(`${API}/slow`, { timeout: [2, "seconds"] })
      .catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 10));
    await time.travel(2_000);
    const error = await slow;
    expect(error).toBeInstanceOf(TimeoutError);

    const late = http.fetch(`${API}/slow`, { timeout: [10, "seconds"] });
    await new Promise((r) => setTimeout(r, 10));
    await time.travel(5_000);
    expect((await late).data).toEqual({ ok: true });

    await alepha.stop();
  });

  it("passes a call to the app's own server through to the real fetch", async ({
    expect,
  }) => {
    class Api {
      hello = $action({
        method: "GET",
        path: "/hello",
        schema: { response: z.object({ hello: z.text() }) },
        handler: () => ({ hello: "world" }),
      });
    }
    const alepha = Alepha.create()
      .with({ provide: HttpClient, use: MemoryHttpClient })
      .with(AlephaServer)
      .with(Api);
    await alepha.start();
    const http = alepha.inject(MemoryHttpClient);
    const hostname = alepha.inject(ServerProvider).hostname;

    const viaAction = await alepha.inject(Api).hello.fetch();
    expect(viaAction.data).toEqual({ hello: "world" });

    const direct = await http.fetch(`${hostname}/api/hello`);
    expect(direct.data).toEqual({ hello: "world" });
    expect(http.recorded).toHaveLength(0);

    // A route registered for the own origin still wins.
    http.on("GET", `${hostname}/api/hello`, () => ({ hello: "faked" }));
    expect((await http.fetch(`${hostname}/api/hello`)).data).toEqual({
      hello: "faked",
    });

    await alepha.stop();
  });

  it("forgets routes and calls on reset", async ({ expect }) => {
    const { http } = create();
    http.on("GET", `${API}/a`, () => "a");
    await http.fetch(`${API}/a`);

    http.reset();

    expect(http.calls()).toHaveLength(0);
    await expect(http.fetch(`${API}/a`)).rejects.toThrow("no route");
  });
});
