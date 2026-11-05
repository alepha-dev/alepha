import { Alepha, z } from "alepha";
import { $secure, AlephaSecurity } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";
import { ServerSwaggerProvider } from "alepha/server/swagger";
import { describe, it } from "vitest";

import { OpenApiSpec } from "../OpenApiSpec.ts";

const product = z
  .object({
    id: z.text(),
    name: z.text().describe("Display name"),
    tags: z.array(z.text()),
    parent: z.object({ id: z.text() }).optional(),
  })
  .meta({ title: "Product" });

class Catalog {
  list = $action({
    path: "/products",
    method: "GET",
    summary: "List products",
    schema: {
      query: z.object({ q: z.text().optional() }),
      response: z.array(product),
    },
    handler: async () => [],
  });

  get = $action({
    path: "/products/:id",
    method: "GET",
    errors: [NotFoundError],
    schema: {
      params: z.object({ id: z.text() }),
      response: product,
    },
    handler: async () => ({ id: "p1", name: "Chair", tags: [] }),
  });

  remove = $action({
    path: "/products/:id",
    method: "DELETE",
    group: "admin",
    use: [$secure({ permissions: ["products:delete"] })],
    schema: { params: z.object({ id: z.text() }) },
    handler: async () => {},
  });
}

/**
 * The explorer's model, over a document the real `$swagger` generator wrote:
 * a hand-written fixture would agree with whatever the model expects.
 */
const spec = () => {
  const alepha = Alepha.create().with(AlephaSecurity).with(Catalog);
  return new OpenApiSpec(
    alepha.inject(ServerSwaggerProvider).generateSwaggerDoc({
      info: { title: "Catalog", version: "2.0.0" },
    }),
  );
};

describe("OpenApiSpec", () => {
  it("lists every operation with a stable id", ({ expect }) => {
    expect(
      spec().entries.map((it) => `${it.id} ${it.method} ${it.path}`),
    ).toEqual([
      "list get /api/products",
      "get get /api/products/{id}",
      "remove delete /api/products/{id}",
    ]);
  });

  it("groups by tag in first-seen order", ({ expect }) => {
    const groups = spec().groups();
    expect(groups.map((g) => [g.tag, g.entries.length])).toEqual([
      ["Catalog", 2],
      ["admin", 1],
    ]);
  });

  it("searches every term across method, path, tag and summary", ({
    expect,
  }) => {
    const s = spec();
    expect(
      s.groups("delete").flatMap((g) => g.entries.map((e) => e.id)),
    ).toEqual(["remove"]);
    expect(
      s.groups("get products list").flatMap((g) => g.entries.map((e) => e.id)),
    ).toEqual(["list"]);
    expect(s.groups("nothing-like-this")).toEqual([]);
  });

  it("resolves a $ref and names it", ({ expect }) => {
    const s = spec();
    const schema =
      s.find("get")!.operation.responses["200"].content!["application/json"]
        .schema;
    expect(s.refName(schema)).toBe("Product");
    expect(Object.keys(s.resolve(schema).properties)).toEqual([
      "id",
      "name",
      "tags",
      "parent",
    ]);
  });

  it("labels types in one line", ({ expect }) => {
    const s = spec();
    const list =
      s.find("list")!.operation.responses["200"].content!["application/json"]
        .schema;
    expect(s.typeLabel(list)).toBe("array<Product>");
    const props = s.resolve({
      $ref: "#/components/schemas/Product",
    }).properties;
    expect(s.typeLabel(props.tags)).toBe("array<string>");
    expect(s.isExpandable(props.parent)).toBe(true);
    expect(s.isExpandable(props.name)).toBe(false);
  });

  it("reads the x-alepha metadata and the gate", ({ expect }) => {
    const s = spec();
    const remove = s.find("remove")!.operation;
    expect(s.isSecured(remove)).toBe(true);
    expect(s.metadata(remove).security).toEqual({
      permissions: ["products:delete"],
    });
    expect(s.metadata(s.find("get")!.operation).errors).toEqual(["NOT_FOUND"]);
    expect(s.isSecured(s.find("list")!.operation)).toBe(false);
  });

  it("reads the document's title and version", ({ expect }) => {
    expect(spec().title).toBe("Catalog");
    expect(spec().version).toBe("2.0.0");
  });
});
