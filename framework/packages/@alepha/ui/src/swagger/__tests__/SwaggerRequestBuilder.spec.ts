import { Alepha, z } from "alepha";
import { $action, $sse, AlephaServer, ServerProvider } from "alepha/server";
import { ServerSwaggerProvider } from "alepha/server/swagger";
import { afterEach, describe, it } from "vitest";

import { OpenApiSpec, type SwaggerEntry } from "../OpenApiSpec.ts";
import { SwaggerRequestBuilder } from "../SwaggerRequestBuilder.ts";
import type { SwaggerResponseResult } from "../SwaggerResponseView.tsx";

class Api {
  update = $action({
    path: "/orders/:id",
    method: "POST",
    schema: {
      params: z.object({ id: z.text() }),
      query: z.object({ notify: z.boolean().optional() }),
      body: z.object({
        note: z.text(),
        quantity: z.integer(),
        address: z.object({ city: z.text() }).optional(),
      }),
      response: z.object({
        id: z.text(),
        notify: z.boolean().optional(),
        note: z.text(),
        quantity: z.integer(),
        city: z.text().optional(),
      }),
    },
    handler: async ({ params, query, body }) => ({
      id: params.id,
      notify: query.notify,
      note: body.note,
      quantity: body.quantity,
      city: body.address?.city,
    }),
  });

  upload = $action({
    path: "/upload",
    method: "POST",
    schema: {
      body: z.object({ label: z.text(), file: z.file() }),
      response: z.object({ label: z.text(), name: z.text(), size: z.number() }),
    },
    handler: async ({ body }) => ({
      label: body.label,
      name: body.file.name,
      size: body.file.size,
    }),
  });

  events = $sse({
    path: "/events",
    schema: { data: z.object({ n: z.number() }) },
    handler: async ({ emit, close }) => {
      emit({ n: 1 });
      emit({ n: 2 });
      close();
    },
  });
}

/**
 * The builder against a running server, over the document the real
 * generator wrote: a request it builds has to be one the server accepts,
 * which no fixture can tell.
 */
describe("SwaggerRequestBuilder", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const start = async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, SERVER_HOST: "127.0.0.1" },
    })
      .with(AlephaServer)
      .with(ServerSwaggerProvider)
      .with(Api);
    await alepha.start();
    const spec = new OpenApiSpec(
      alepha.inject(ServerSwaggerProvider).generateSwaggerDoc({}),
    );
    return {
      spec,
      builder: new SwaggerRequestBuilder(spec),
      origin: alepha.inject(ServerProvider).hostname,
    };
  };

  const send = async (
    builder: SwaggerRequestBuilder,
    request: ReturnType<SwaggerRequestBuilder["request"]>,
  ) => {
    const seen: SwaggerResponseResult[] = [];
    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    const result = await builder.read(
      res,
      () => 0,
      (r) => seen.push(r),
    );
    return { result, seen };
  };

  it("builds a field per parameter and per body property", async ({
    expect,
  }) => {
    const { spec, builder } = await start();
    const model = builder.build(spec.find("update")!, "form");
    expect(model.targets).toEqual({
      id: { in: "path", name: "id" },
      notify: { in: "query", name: "notify" },
      note: { in: "field", name: "note" },
      quantity: { in: "field", name: "quantity" },
      address: { in: "field", name: "address" },
    });
    expect(model.formable).toBe(true);
    expect(model.mode).toBe("form");
  });

  it("sends path, query and a JSON body the server accepts", async ({
    expect,
  }) => {
    const { spec, builder, origin } = await start();
    const entry = spec.find("update")!;
    const model = builder.build(entry, "form");
    const request = builder.request(
      entry,
      model,
      {
        id: "o 1",
        notify: true,
        note: "ring twice",
        quantity: 3,
        address: { city: "Lyon" },
      },
      origin,
    );
    expect(request.url).toBe(`${origin}/api/orders/o%201?notify=true`);

    const { result } = await send(builder, request);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      id: "o 1",
      notify: true,
      note: "ring twice",
      quantity: 3,
      city: "Lyon",
    });
  });

  it("sends the body as raw JSON in json mode, seeded from the schema", async ({
    expect,
  }) => {
    const { spec, builder, origin } = await start();
    const entry = spec.find("update")!;
    const model = builder.build(entry, "json");
    expect(model.mode).toBe("json");
    expect(JSON.parse(model.initialValues.body as string)).toEqual({
      note: "",
      quantity: 0,
      address: { city: "" },
    });

    const request = builder.request(
      entry,
      model,
      { id: "o2", body: JSON.stringify({ note: "raw", quantity: 1 }) },
      origin,
    );
    const { result } = await send(builder, request);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ id: "o2", note: "raw" });
  });

  it("sends a multipart body, a file input per binary part", async ({
    expect,
  }) => {
    const { spec, builder, origin } = await start();
    const entry = spec.find("upload")!;
    const model = builder.build(entry, "form");
    expect(model.mediaType).toBe("multipart/form-data");
    expect(model.fields).toEqual({ file: { file: true } });

    const file = new File(["hello world"], "hello.txt", { type: "text/plain" });
    const request = builder.request(
      entry,
      model,
      { label: "greeting", file },
      origin,
    );
    expect(request.headers["content-type"]).toBeUndefined();

    const { result } = await send(builder, request);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      label: "greeting",
      name: "hello.txt",
      size: 11,
    });
  });

  it("reads a streamed response as it arrives", async ({ expect }) => {
    const { builder, origin } = await start();
    const entry: SwaggerEntry = {
      id: "events",
      // `$sse` is always a POST, and not an `$action`: not in the document.
      method: "post",
      path: "/api/events",
      tag: "Api",
      operation: { responses: {} },
    };
    const model = builder.build(entry, "form");
    const { result, seen } = await send(
      builder,
      builder.request(entry, model, {}, origin),
    );
    expect(result.done).toBe(true);
    expect(result.contentType).toContain("text/event-stream");
    expect(result.body).toContain('{"n":1}');
    expect(result.body).toContain('{"n":2}');
    // The headers first, empty and not done, then the chunks.
    expect(seen[0]).toMatchObject({ body: "", done: false });
    expect(seen[seen.length - 1]?.done).toBe(true);
  });

  it("seeds an example from defaults, enums and nested shapes", async ({
    expect,
  }) => {
    const { builder } = await start();
    expect(
      builder.example({
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "closed"] },
          size: { type: "integer", default: 20 },
          tags: { type: "array", items: { type: "string" } },
        },
      }),
    ).toEqual({ status: "open", size: 20, tags: [""] });
  });
});
