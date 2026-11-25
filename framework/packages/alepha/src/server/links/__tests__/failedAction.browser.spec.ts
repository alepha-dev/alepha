import { Alepha, z } from "alepha";
import { $action, HttpClient, type HttpError } from "alepha/server";
import { afterEach, describe, expect, it } from "vitest";

import { AlephaServerLinksClient, LinkProvider } from "../index.ts";

class Api {
  listPrompts = $action({
    path: "/prompts",
    method: "GET",
    schema: { response: z.text() },
    handler: () => "prompts",
  });

  getEpics = $action({
    path: "/epics",
    method: "GET",
    schema: { response: z.text() },
    handler: () => "epics",
  });
}

/**
 * Answers a batch with `listPrompts` failing as a production 500 does, and a
 * direct call with a 500 body carrying its request id.
 */
class FailingHttpClient extends HttpClient {
  public static gatewayDown = false;

  protected override async transport(
    url: string,
    request: RequestInit,
  ): Promise<Response> {
    if (url.startsWith("/api/_batch") && FailingHttpClient.gatewayDown) {
      return new Response("Bad Gateway", {
        status: 502,
        headers: { "content-type": "text/plain" },
      });
    }
    if (url.startsWith("/api/_batch")) {
      const entries: Array<{ action: string }> = JSON.parse(
        request.body as string,
      );
      return Response.json(
        entries.map(({ action }) =>
          action === "listPrompts"
            ? {
                action,
                status: 500,
                name: "INTERNAL_SERVER_ERROR",
                error: "Internal Server Error",
                requestId: "req-batch",
              }
            : { action, status: 200, data: action },
        ),
      );
    }
    return Response.json(
      {
        name: "INTERNAL_SERVER_ERROR",
        message: "Internal Server Error",
        data: { status: 500, requestId: "req-direct" },
      },
      { status: 500 },
    );
  }
}

const setup = async () => {
  const alepha = Alepha.create()
    .with({ provide: HttpClient, use: FailingHttpClient })
    .with(AlephaServerLinksClient);
  await alepha.start();
  alepha.store.set("alepha.server.request.apiLinks", {
    actions: {
      listPrompts: { path: "/prompts", method: "GET" },
      getEpics: { path: "/epics", method: "GET" },
    },
  });
  // Wrapped: the client is a proxy, and an awaited proxy is asked for `then`.
  return { api: alepha.inject(LinkProvider).client<Api>() };
};

describe("a failed $client call names its action", () => {
  afterEach(() => {
    FailingHttpClient.gatewayDown = false;
  });

  it("names each action when the batch request itself fails", async () => {
    FailingHttpClient.gatewayDown = true;
    const { api } = await setup();

    const [epics, prompts] = await Promise.allSettled([
      api.getEpics(),
      api.listPrompts(),
    ]);

    const names = [epics, prompts].map(
      (it) => ((it as PromiseRejectedResult).reason as HttpError).action?.name,
    );
    expect(names).toEqual(["getEpics", "listPrompts"]);
    expect(
      ((prompts as PromiseRejectedResult).reason as HttpError).status,
    ).toBe(502);
  });

  it("stamps the action, its method and path on a batched failure, beside the request id", async () => {
    const { api } = await setup();

    const [epics, prompts] = await Promise.allSettled([
      api.getEpics(),
      api.listPrompts(),
    ]);

    expect(epics).toEqual({ status: "fulfilled", value: "getEpics" });
    const error = (prompts as PromiseRejectedResult).reason as HttpError;
    expect(error.status).toBe(500);
    expect(error.action).toEqual({
      name: "listPrompts",
      method: "GET",
      path: "/api/prompts",
    });
    expect(error.data.requestId).toBe("req-batch");
  });

  it("stamps a call sent on its own the same way", async () => {
    const { api } = await setup();

    const error = (await api.listPrompts().catch((e) => e)) as HttpError;

    expect(error.action).toEqual({
      name: "listPrompts",
      method: "GET",
      path: "/api/prompts",
    });
    expect(error.data.requestId).toBe("req-direct");
  });
});
