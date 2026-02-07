import { Alepha } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { afterEach, describe, expect, test } from "vitest";
import { AlephaSecurity } from "../index.ts";

class TestApp {
  post = $action({
    method: "POST",
    handler: () => "ok",
  });
  get = $action({
    handler: () => "ok",
  });
  put = $action({
    method: "PUT",
    handler: () => "ok",
  });
  patch = $action({
    method: "PATCH",
    handler: () => "ok",
  });
  del = $action({
    path: "/remove",
    method: "DELETE",
    handler: () => "ok",
  });
}

describe("ServerCsrfProvider", () => {
  let alepha: Alepha;
  let server: ServerProvider;
  let app: TestApp;

  const setup = async () => {
    alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(TestApp);

    server = alepha.inject(ServerProvider);
    app = alepha.inject(TestApp);
    await alepha.start();
  };

  afterEach(async () => {
    if (alepha) await alepha.stop();
  });

  test("allows GET requests regardless of origin", async () => {
    await setup();

    const response = await fetch(`${server.hostname}${app.get.route.path}`, {
      headers: { Origin: "https://evil.com" },
    });
    expect(response.status).toBe(200);
  });

  test("allows POST from same origin", async () => {
    await setup();

    const response = await fetch(`${server.hostname}${app.post.route.path}`, {
      method: "POST",
      headers: { Origin: server.hostname },
    });
    expect(response.status).toBe(200);
  });

  test("blocks POST from cross origin", async () => {
    await setup();

    const response = await fetch(`${server.hostname}${app.post.route.path}`, {
      method: "POST",
      headers: { Origin: "https://evil.com" },
    });
    expect(response.status).toBe(403);
  });

  test("allows POST without Origin header", async () => {
    await setup();

    const response = await fetch(`${server.hostname}${app.post.route.path}`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
  });

  test("blocks PUT from cross origin", async () => {
    await setup();

    const response = await fetch(`${server.hostname}${app.put.route.path}`, {
      method: "PUT",
      headers: { Origin: "https://evil.com" },
    });
    expect(response.status).toBe(403);
  });

  test("blocks PATCH from cross origin", async () => {
    await setup();

    const response = await fetch(`${server.hostname}${app.patch.route.path}`, {
      method: "PATCH",
      headers: { Origin: "https://evil.com" },
    });
    expect(response.status).toBe(403);
  });

  test("blocks DELETE from cross origin", async () => {
    await setup();

    const response = await fetch(`${server.hostname}${app.del.route.path}`, {
      method: "DELETE",
      headers: { Origin: "https://evil.com" },
    });
    expect(response.status).toBe(403);
  });

  test("falls back to Referer when Origin is absent", async () => {
    await setup();

    const blocked = await fetch(`${server.hostname}${app.post.route.path}`, {
      method: "POST",
      headers: { Referer: "https://evil.com/page" },
    });
    expect(blocked.status).toBe(403);

    const allowed = await fetch(`${server.hostname}${app.post.route.path}`, {
      method: "POST",
      headers: { Referer: `${server.hostname}/some/page` },
    });
    expect(allowed.status).toBe(200);
  });
});
