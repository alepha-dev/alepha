import { Alepha } from "alepha/core";
import { $action, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import { AlephaServerCompress } from "../../src/server-compress";

class App {
  hello = $action({
    handler: () => "Hello, world!",
  });
}

const a1 = Alepha.create().with(App).with(AlephaServerCompress);
const a2 = Alepha.create().with(App);

describe("ServerCompressProvider", () => {
  it("should compress responses when enabled", async ({ expect }) => {
    const serv1 = a1.inject(ServerProvider);
    const serv2 = a2.inject(ServerProvider);

    const resp1 = await fetch(`${serv1.hostname}/api/hello`, {
      headers: { "Accept-Encoding": "gzip" },
    });

    const resp2 = await fetch(`${serv2.hostname}/api/hello`, {
      headers: { "Accept-Encoding": "gzip" },
    });

    expect(resp1.headers.get("content-encoding")).toBe("gzip");
    expect(resp2.headers.get("content-encoding")).toBeNull();
  });
});
