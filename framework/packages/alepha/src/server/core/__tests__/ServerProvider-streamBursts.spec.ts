import { connect } from "node:net";

import { Alepha } from "alepha";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

/**
 * An uncompressed web-stream body is written once per burst, not once per
 * chunk. A server-rendered page arrives as about twenty small chunks within
 * one macrotask; each used to cost a socket write and a chunked-encoding
 * frame. Read from a raw socket, the chunks of one burst must sit in one
 * frame, and the first burst must arrive before the second is produced.
 */
describe("ServerProvider web-stream bursts", () => {
  it("writes a burst's chunks as one frame, before the next burst", async ({
    expect,
  }) => {
    let secondProduced = false;
    class App {
      stream = $route({
        path: "/waiting",
        handler: ({ reply }) => {
          const encoder = new TextEncoder();
          reply.setHeader("content-type", "text/html");
          reply.body = new ReadableStream({
            async start(controller) {
              controller.enqueue(encoder.encode("<h1>Shell</h1>"));
              controller.enqueue(encoder.encode("<p>first burst</p>"));
              await new Promise((resolve) => setTimeout(resolve, 300));
              secondProduced = true;
              controller.enqueue(encoder.encode("<p>second</p>"));
              controller.enqueue(encoder.encode("<p>burst</p>"));
              controller.close();
            },
          });
        },
      });
    }

    const alepha = Alepha.create().with(App).with(AlephaServer);
    await alepha.start();
    const url = new URL(alepha.inject(ServerProvider).hostname);

    const socket = connect(Number(url.port), url.hostname);
    socket.write(
      "GET /waiting HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n",
    );
    let raw = "";
    let sawFirstEarly = false;
    await new Promise<void>((resolve, reject) => {
      socket.on("data", (data) => {
        raw += data.toString();
        if (raw.includes("first burst") && !secondProduced) {
          sawFirstEarly = true;
        }
      });
      socket.once("end", resolve);
      socket.once("error", reject);
    });

    expect(sawFirstEarly).toBe(true);
    const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
    // One frame per burst: the size line, then both chunks back to back.
    expect(body).toContain("\r\n<h1>Shell</h1><p>first burst</p>\r\n");
    expect(body).toContain("\r\n<p>second</p><p>burst</p>\r\n");

    await alepha.stop();
  });
});
