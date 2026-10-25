import { Alepha, z } from "alepha";
import {
  $secure,
  AlephaSecurity,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import { $sse, HttpError, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { LinkProvider } from "../providers/LinkProvider.ts";

class HeaderSecurityProvider extends SecurityProvider {
  public override async resolveUserFromServerRequest(request: {
    headers: Record<string, string | undefined>;
  }): Promise<UserAccountToken | undefined> {
    const id = request.headers["x-user"];
    return id ? { id, realm: "default", roles: ["member"] } : undefined;
  }
}

/**
 * The browser's path, reached from Node: `follow()` takes it for a link with
 * no local handler, which is every link a browser holds.
 */
class TestLinkProvider extends LinkProvider {
  public testFollowStream = this.followStream.bind(this);
}

class Api {
  echo = $sse({
    path: "/echo/:id",
    use: [$secure()],
    schema: {
      params: z.object({ id: z.text() }),
      query: z.object({ times: z.integer() }),
      body: z.object({ word: z.text() }),
      data: z.object({ n: z.integer(), word: z.text(), by: z.text() }),
    },
    handler: async ({ params, query, body, user, emit }) => {
      for (let n = 1; n <= (query.times ?? 1); n++) {
        emit({ n, word: `${params.id}:${body.word}`, by: user.id });
      }
    },
  });
}

describe("LinkProvider $sse over HTTP", () => {
  const setup = async () => {
    const alepha = Alepha.create()
      .with({ provide: SecurityProvider, use: HeaderSecurityProvider })
      .with({ provide: LinkProvider, use: TestLinkProvider })
      .with(AlephaSecurity);
    alepha.inject(Api);
    await alepha.start();
    const host = alepha.inject(ServerProvider).hostname;
    const links = alepha.inject(LinkProvider) as TestLinkProvider;
    const link = {
      name: "echo",
      kind: "sse",
      method: "POST",
      path: "/echo/:id",
      host,
    };
    return { links, link };
  };

  it("streams typed events with params, query, body and headers", async ({
    expect,
  }) => {
    const { links, link } = await setup();
    const stream = await links.testFollowStream(
      link,
      { params: { id: "a" }, query: { times: 3 }, body: { word: "hi" } },
      { request: { headers: { "x-user": "u1" } } },
    );
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(events).toEqual([
      { n: 1, word: "a:hi", by: "u1" },
      { n: 2, word: "a:hi", by: "u1" },
      { n: 3, word: "a:hi", by: "u1" },
    ]);
  });

  it("rejects with the typed error of a refusal before the stream opens", async ({
    expect,
  }) => {
    const { links, link } = await setup();
    const refused = await links
      .testFollowStream(link, {
        params: { id: "a" },
        query: { times: 1 },
        body: { word: "hi" },
      })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).data.status).toBe(401);
  });
});
