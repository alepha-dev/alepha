import { describe, it } from "vitest";

import { SseReader } from "../index.ts";

describe("SseReader", () => {
  const reader = new SseReader();

  const streamOf = (...chunks: Array<string | Uint8Array>) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(
            typeof chunk === "string" ? encoder.encode(chunk) : chunk,
          );
        }
        controller.close();
      },
    });

  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const events = [];
    for await (const event of reader.read(stream)) {
      events.push(event);
    }
    return events;
  };

  it("reads events split across chunks at any byte", async ({ expect }) => {
    const raw =
      'event: delta\ndata: {"a":1}\n\nevent: delta\ndata: {"a":2}\n\n';
    const chunks = raw.split("").map((c) => c);
    expect(await collect(streamOf(...chunks))).toEqual([
      { event: "delta", data: '{"a":1}' },
      { event: "delta", data: '{"a":2}' },
    ]);
  });

  it("decodes a UTF-8 character split across two chunks", async ({
    expect,
  }) => {
    const bytes = new TextEncoder().encode("data: café\n\n");
    const cut = bytes.indexOf(0xc3) + 1;
    expect(
      await collect(streamOf(bytes.slice(0, cut), bytes.slice(cut))),
    ).toEqual([{ data: "café" }]);
  });

  it("skips comments and keep-alives", async ({ expect }) => {
    expect(
      await collect(streamOf(": ping\n\n:\ndata: x\n: mid-event comment\n\n")),
    ).toEqual([{ data: "x" }]);
  });

  it("joins multi-line data with newlines", async ({ expect }) => {
    expect(
      await collect(streamOf("data: line one\ndata:line two\ndata\n\n")),
    ).toEqual([{ data: "line one\nline two\n" }]);
  });

  it("accepts CRLF and lone CR line endings, a CRLF split across chunks too", async ({
    expect,
  }) => {
    expect(
      await collect(streamOf("data: a\r", "\n\r\ndata: b\r\rid: 7\r\n\r\n")),
    ).toEqual([{ data: "a" }, { data: "b" }]);
  });

  it("keeps only one leading space and reads id and retry", async ({
    expect,
  }) => {
    expect(
      await collect(streamOf("id: 42\nretry: 1500\ndata:  two spaces\n\n")),
    ).toEqual([{ data: " two spaces", id: "42", retry: 1500 }]);
  });

  it("dispatches an event the stream closed without a blank line", async ({
    expect,
  }) => {
    expect(await collect(streamOf("data: one\n\ndata: [DONE]"))).toEqual([
      { data: "one" },
      { data: "[DONE]" },
    ]);
  });

  it("throws the abort reason and cancels the stream on abort", async ({
    expect,
  }) => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();

    await expect(
      (async () => {
        for await (const _ of reader.read(stream, controller.signal)) {
          controller.abort(new Error("user left"));
        }
      })(),
    ).rejects.toThrow("user left");
    expect(cancelled).toBe(true);
  });
});
