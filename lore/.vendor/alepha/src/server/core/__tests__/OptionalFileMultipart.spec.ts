import { Alepha, type FileLike, z } from "alepha";
import {
  $route,
  AlephaServer,
  isMultipart,
  ServerProvider,
} from "alepha/server";
import { describe, it } from "vitest";

const BOUNDARY = "----AlephaBoundary";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * One text field and one file part, exactly as a browser sends them.
 */
const bodyOf = (): Blob => {
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="title"\r\n\r\n` +
      `a report\r\n` +
      `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="screenshot"; filename="shot.png"\r\n` +
      `Content-Type: image/png\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${BOUNDARY}--\r\n`);
  const out = new Uint8Array(
    new ArrayBuffer(head.length + PNG.length + tail.length),
  );
  out.set(head, 0);
  out.set(PNG, head.length);
  out.set(tail, head.length + PNG.length);
  return new Blob([out]);
};

/**
 * A file field that is merely not mandatory is still a file field.
 *
 * `z.file()` tags the schema `format: "binary"` through `.meta()`, and both
 * ends read that tag: the client to build a FormData, the server to parse one.
 * `.optional()` returns a NEW ZodOptional whose own `.meta()` is empty, so
 * reading the wrapper answered `undefined` and the two ends agreed to do
 * nothing — the upload went out as JSON and came back decoded as text, with no
 * error anywhere to say so.
 */
describe("an optional file field is still multipart", () => {
  it("is detected on the schema, wrapper or not", ({ expect }) => {
    expect(isMultipart({ schema: { body: z.object({ f: z.file() }) } })).toBe(
      true,
    );
    expect(
      isMultipart({ schema: { body: z.object({ f: z.file().optional() }) } }),
    ).toBe(true);
    expect(
      isMultipart({ schema: { body: z.object({ f: z.stream().optional() }) } }),
    ).toBe(true);
    // Nullable and defaulted wrappers peel the same way.
    expect(
      isMultipart({
        schema: { body: z.object({ f: z.file().nullable() }) },
      }),
    ).toBe(true);
    // Still false when there is genuinely no file in the body.
    expect(isMultipart({ schema: { body: z.object({ f: z.text() }) } })).toBe(
      false,
    );
  });

  it("reaches the handler as bytes, not as decoded text", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, SERVER_HOST: "127.0.0.1" },
    });

    class ReportApi {
      submit = $route({
        method: "POST",
        path: "/report",
        schema: {
          body: z.object({
            title: z.text(),
            screenshot: z.file({ maxBytes: 1024 * 1024 }).optional(),
          }),
        },
        handler: async ({ body }) => {
          const file = body.screenshot as FileLike | undefined;
          const bytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
          return {
            title: body.title,
            // `type` is what a handler routes on to accept or refuse an
            // upload; it is undefined on anything that was decoded as text.
            type: file?.type,
            filename: file?.name,
            head: bytes ? [...bytes.subarray(0, 4)] : null,
            size: bytes?.length ?? 0,
          } as never;
        },
      });
    }

    alepha.with(AlephaServer);
    alepha.inject(ReportApi);
    const server = alepha.inject(ServerProvider);
    await alepha.start();

    const res = await fetch(`${server.hostname}/report`, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      body: bodyOf(),
    });

    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      title: string;
      type?: string;
      filename?: string;
      head: number[] | null;
      size: number;
    };

    expect(out.title).toBe("a report");
    expect(out.type).toBe("image/png");
    expect(out.filename).toBe("shot.png");
    // The PNG magic number, byte for byte: proof the part was materialised
    // rather than run through a text decoder.
    expect(out.head).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(out.size).toBe(PNG.length);

    await alepha.stop();
  });

  it("still accepts the request when the optional file is absent", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, SERVER_HOST: "127.0.0.1" },
    });

    class ReportApi {
      submit = $route({
        method: "POST",
        path: "/report",
        schema: {
          body: z.object({
            title: z.text(),
            screenshot: z.file().optional(),
          }),
        },
        handler: async ({ body }) =>
          ({ title: body.title, hasFile: !!body.screenshot }) as never,
      });
    }

    alepha.with(AlephaServer);
    alepha.inject(ReportApi);
    const server = alepha.inject(ServerProvider);
    await alepha.start();

    const body = new Blob([
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="title"\r\n\r\n` +
        `no shot\r\n` +
        `--${BOUNDARY}--\r\n`,
    ]);

    const res = await fetch(`${server.hostname}/report`, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      body,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "no shot", hasFile: false });

    await alepha.stop();
  });
});
