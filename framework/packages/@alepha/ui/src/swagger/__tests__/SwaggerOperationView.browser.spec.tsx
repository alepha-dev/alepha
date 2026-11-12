import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { OpenApiDocument } from "alepha/server/swagger";
import { setupJsdomMocks, expectAccessible } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { OpenApiSpec } from "../OpenApiSpec.ts";
import { SwaggerNav } from "../SwaggerNav.tsx";
import { SwaggerOperationView } from "../SwaggerOperationView.tsx";

/**
 * A document in the shape `$swagger` writes, `x-alepha-*` included (the
 * generator's own output is covered by `OpenApiSpec.spec.ts`).
 */
const document: OpenApiDocument = {
  openapi: "3.0.0",
  info: { title: "Shop", version: "1.0.0" },
  paths: {
    "/api/orders/{id}": {
      delete: {
        operationId: "deleteOrder",
        summary: "Delete an order",
        tags: ["orders"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "204": { description: "No Content" },
          "404": {
            description: "Not Found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NOT_FOUND" },
              },
            },
          },
        },
        "x-alepha-action": { name: "deleteOrder", group: "orders" },
        "x-alepha-middlewares": ["$secure"],
        "x-alepha-security": {
          roles: ["admin"],
          permissions: ["orders:delete"],
        },
        "x-alepha-errors": ["NOT_FOUND"],
        "x-alepha-timeout": 30000,
      },
    },
    "/api/orders": {
      post: {
        operationId: "createOrder",
        tags: ["orders"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["sku"],
                properties: {
                  sku: { type: "string", description: "Product reference" },
                  address: {
                    type: "object",
                    properties: { city: { type: "string" } },
                  },
                },
              },
            },
          },
        },
        responses: { "200": { description: "OK" } },
      },
    },
  },
  components: {
    schemas: {
      NOT_FOUND: {
        type: "object",
        properties: {
          name: { const: "NOT_FOUND" },
          message: { type: "string" },
        },
      },
    },
  },
};

describe("SwaggerOperationView", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (node: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{node}</AlephaContext.Provider>,
    );
  };

  const spec = new OpenApiSpec(document);

  it("shows the operation, its access and its metadata", async () => {
    await mount(
      <SwaggerOperationView spec={spec} entry={spec.find("deleteOrder")!} />,
    );
    expect(screen.getByText("/api/orders/{id}")).toBeTruthy();
    expect(screen.getByText("Delete an order")).toBeTruthy();
    expect(screen.getByLabelText("Requires sign-in")).toBeTruthy();
    expect(screen.getByText("orders.deleteOrder")).toBeTruthy();
    expect(screen.getByText("admin")).toBeTruthy();
    expect(screen.getByText("orders:delete")).toBeTruthy();
    expect(screen.getByText("$secure")).toBeTruthy();
    expect(screen.getAllByText("NOT_FOUND").length).toBeGreaterThan(0);
    expect(screen.getByText("30000 ms")).toBeTruthy();
    // axe: an operation view (#Q3338).
    await expectAccessible();
  });

  it("lists parameters and responses by status", async () => {
    const view = await mount(
      <SwaggerOperationView spec={spec} entry={spec.find("deleteOrder")!} />,
    );
    expect(screen.getByText("Parameters")).toBeTruthy();
    expect(screen.getByText("path")).toBeTruthy();
    const statuses = [...view.container.querySelectorAll("[data-slot=badge]")]
      .map((it) => it.textContent)
      .filter((text) => /^\d{3}$/.test(text ?? ""));
    expect(statuses).toEqual(["204", "404"]);
  });

  it("renders the body schema as a tree, required fields marked", async () => {
    const view = await mount(
      <SwaggerOperationView spec={spec} entry={spec.find("createOrder")!} />,
    );
    expect(screen.getByText("Request body")).toBeTruthy();
    expect(screen.getByText("sku")).toBeTruthy();
    expect(screen.getByText("Product reference")).toBeTruthy();
    expect(screen.getByText("required")).toBeTruthy();
    // `address` is an object: it opens, and its field is inside the details.
    const address = screen.getByText("address").closest("details");
    expect(address).toBeTruthy();
    expect(address!.textContent).toContain("city");
    expect(
      view.container.querySelector("[aria-label='Requires sign-in']"),
    ).toBeNull();
  });
});

describe("SwaggerNav", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("filters by the query and reports the selection", async () => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    const spec = new OpenApiSpec(document);
    const picked: string[] = [];
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <SwaggerNav
          spec={spec}
          query="delete"
          onQueryChange={() => {}}
          onSelect={(id) => picked.push(id)}
        />
      </AlephaContext.Provider>,
    );
    const buttons = view.container.querySelectorAll("button");
    expect(buttons.length).toBe(1);
    fireEvent.click(buttons[0]);
    expect(picked).toEqual(["deleteOrder"]);
  });
});
