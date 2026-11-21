import { Alepha, z } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

/**
 * A chunked request whose body is one delimiter followed by spaces: no
 * `Content-Length` for the cheap pre-check to refuse, and no content for the
 * file limit to count.
 */
describe("padding after a multipart boundary, end to end", () => {
  class UploadApi {
    upload = $action({
      method: "POST",
      path: "/upload",
      schema: {
        body: z.object({ file: z.file({ maxBytes: 1024 }) }),
        response: z.text(),
      },
      handler: () => "ok",
    });
  }

  const send = async (megabytes: number) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, SERVER_HOST: "127.0.0.1" },
    }).with(UploadApi);
    await alepha.start();
    const host = alepha.inject(ServerProvider).hostname;

    const spaces = new Uint8Array(64 * 1024).fill(0x20);
    const chunks = megabytes * 16;
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 0) {
          controller.enqueue(new TextEncoder().encode("--b"));
        } else if (sent <= chunks) {
          controller.enqueue(spaces);
        } else {
          controller.close();
        }
        sent++;
      },
    });

    try {
      const response = await fetch(`${host}/api/upload`, {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=b" },
        body,
        duplex: "half",
      } as RequestInit);
      await response.text();
      return { status: response.status, sent, chunks };
    } finally {
      await alepha.stop();
    }
  };

  it("is refused before the body is read in full", async ({ expect }) => {
    const result = await send(32);

    expect(result.status).toBe(400);
    // A loose bound: how much the client had handed over when the answer
    // landed depends on what the sockets buffer. The exact number of bytes
    // the parser reads before refusing is asserted on the parser itself, in
    // `MultipartStreamParser.spec.ts`.
    expect(result.sent).toBeLessThan(result.chunks / 2);
  });
});
