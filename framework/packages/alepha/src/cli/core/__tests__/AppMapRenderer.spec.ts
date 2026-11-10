import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import { describe, expect, it } from "vitest";

import { DocsCommand } from "../commands/docs.ts";
import {
  type AppMapInput,
  AppMapRenderer,
} from "../services/AppMapRenderer.ts";

describe("AppMapRenderer", () => {
  const input = (): AppMapInput => ({
    name: "SHOP",
    actions: [
      {
        name: "getOrder",
        group: "orders",
        method: "GET",
        path: "/orders/:id",
        prefix: "/api",
        fullPath: "/api/orders/:id",
        description: "Read an order",
        secure: true,
        params: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } },
          required: ["id"],
        },
        response: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { enum: ["paid", "shipped"] },
            notes: { type: "string" },
            lines: {
              type: "array",
              items: {
                type: "object",
                properties: { qty: { type: "integer" } },
                required: ["qty"],
              },
            },
          },
          required: ["id", "status", "lines"],
        },
      },
      {
        name: "listProducts",
        group: "products",
        method: "GET",
        path: "/products",
        prefix: "/api",
        fullPath: "/api/products",
      },
      {
        name: "internal",
        group: "x",
        method: "POST",
        path: "/x",
        prefix: "/api",
        fullPath: "/api/x",
        hide: true,
      },
    ],
    entities: [
      {
        name: "orders",
        provider: "postgres",
        columns: [
          {
            name: "id",
            type: "uuid",
            nullable: false,
            primaryKey: true,
            identity: false,
            createdAt: false,
            updatedAt: false,
            deletedAt: false,
            version: false,
            hasDefault: true,
          },
          {
            name: "userId",
            type: "uuid",
            nullable: true,
            primaryKey: false,
            identity: false,
            createdAt: false,
            updatedAt: false,
            deletedAt: false,
            version: false,
            hasDefault: false,
            ref: { entity: "users", column: "id" },
          },
        ],
        indexes: [],
        foreignKeys: [],
        constraints: [],
      },
    ],
    pages: [
      {
        name: "orderDetail",
        path: "/orders/:id",
        hasComponent: true,
        hasLazy: false,
        hasResolve: true,
        hasChildren: false,
        hasParent: false,
        hasErrorHandler: false,
      },
    ],
    routes: [{ method: "GET", path: "/health" }],
    jobs: [
      {
        name: "orders.sweep",
        mode: "cron",
        cron: "0 3 * * *",
        retention: {} as any,
      },
    ],
    topics: [],
    envs: [
      {
        propertyKey: "env_0",
        schema: {
          type: "object",
          properties: {
            STRIPE_SECRET_KEY: { type: "string" },
            SHOP_CURRENCY: { type: "string", default: "EUR" },
          },
          required: ["STRIPE_SECRET_KEY", "SHOP_CURRENCY"],
        },
        values: {
          STRIPE_SECRET_KEY: "sk_live_should_never_print",
          SHOP_CURRENCY: "EUR",
        },
        serviceName: "PaymentService",
      },
    ],
  });

  const renderer = () => Alepha.create().inject(AppMapRenderer);

  describe("the overview", () => {
    it("names every section with its count and lists items one per line", () => {
      const text = renderer().render(input());

      expect(text).toContain(
        "Sections: actions (2), entities (1), pages (1), routes (1), jobs (1), topics (0), env (2).",
      );
      expect(text).toContain(
        "- GET `/api/orders/:id` `orders.getOrder` (secure): Read an order",
      );
      expect(text).toContain("- `orders`: id, userId");
      expect(text).toContain("- GET `/health`");
      expect(text).toContain("- `orders.sweep` (cron `0 3 * * *`)");
    });

    it("leaves out hidden actions and every schema", () => {
      const text = renderer().render(input());

      expect(text).not.toContain("/api/x");
      expect(text).not.toContain("response:");
    });
  });

  describe("a section in full", () => {
    it("prints an action's schemas as TypeScript-like types", () => {
      const text = renderer().render(input(), "actions");

      expect(text).toContain("### GET /api/orders/:id");
      expect(text).toContain("- params: `{ id: string (uuid) }`");
      expect(text).toContain(
        '- response: `{ id: string; status: "paid" | "shipped"; notes?: string; lines: { qty: number }[] }`',
      );
      expect(text).not.toContain("## Entities");
    });

    it("prints an entity's columns with their roles and references", () => {
      const text = renderer().render(input(), "entities");

      expect(text).toContain("| id | uuid | primary key, default |");
      expect(text).toContain("| userId | uuid | nullable, -> users.id |");
    });
  });

  describe("the environment", () => {
    it("prints names, types and defaults, never values", () => {
      const text = renderer().render(input(), "env");

      expect(text).toContain(
        "| STRIPE_SECRET_KEY | string |  | PaymentService |",
      );
      expect(text).toContain(
        '| SHOP_CURRENCY? | string | `"EUR"` | PaymentService |',
      );
      expect(text).not.toContain("sk_live_should_never_print");
    });
  });

  describe("modules, atoms, realms, roles and permissions", () => {
    const withAll = (): AppMapInput => ({
      ...input(),
      modules: [{ name: "shop", providers: ["OrderService", "CartService"] }],
      atoms: [
        {
          name: "shop.settings",
          schema: { type: "object", properties: { vat: { type: "number" } } },
          currentValue: { vat: 0.2, apiKey: "atom_value_never_prints" },
          serverOnly: true,
        },
      ],
      realms: [{ name: "customers", type: "internal", roles: ["buyer"] }],
      roles: [
        {
          name: "buyer",
          realm: "customers",
          grants: [{ name: "orders:read", ownership: true }],
          effective: ["orders:read"],
          viaWildcard: [],
        },
      ],
      permissions: [{ id: "orders:read", name: "read", group: "orders" }],
    });

    it("lists them when the input has them, and leaves out absent sections", () => {
      const text = renderer().render(withAll());
      expect(text).toContain(
        "modules (1), atoms (1), realms (1), roles (1), permissions (1), env (2).",
      );
      expect(text).toContain("- `shop` (2 providers)");
      expect(text).toContain("- `shop.settings` (server only)");
      expect(text).toContain("- `customers` (internal, roles buyer)");
      expect(text).toContain("- `buyer` (realm customers, 1 permissions)");
      expect(text).toContain("- `orders:read`");

      const { routes: _, ...noRoutes } = input();
      expect(renderer().render(noRoutes)).not.toContain("routes (");
      expect(renderer().render(input())).not.toContain("modules (");
    });

    it("prints an atom's type in full, never its value", () => {
      const text = renderer().render(withAll(), "atoms");
      expect(text).toContain(
        "- `shop.settings` ({ vat?: number }, server only)",
      );
      expect(text).not.toContain("atom_value_never_prints");
    });

    it("describes one item by kind and name, and suggests on a miss", () => {
      const r = renderer();
      expect(r.describe(withAll(), "role", "buyer")).toContain(
        "  - grants: orders:read (own)",
      );
      expect(r.describe(withAll(), "action", "orders.getOrder")).toContain(
        "- secure: a signed-in user",
      );
      expect(r.describe(withAll(), "action", "nope")).toBeUndefined();
      expect(r.candidates(withAll(), "action", "order")).toEqual([
        "orders.getOrder",
      ]);
    });
  });

  describe("filtering", () => {
    it("keeps the matching items and recounts the heading", () => {
      const text = renderer().render(input(), "actions", "order");

      expect(text).toContain('## Actions (1 matching "order")');
      expect(text).toContain("### GET /api/orders/:id");
      expect(text).not.toContain("/api/products");
    });

    it("filters every section of the overview", () => {
      const text = renderer().render(input(), undefined, "health");

      expect(text).toContain('## Routes (1 matching "health")');
      // A section with no match is left out, heading included.
      expect(text).not.toContain("## Actions");
      expect(text).not.toContain("(0 matching");
    });

    it("says so when nothing matches at all", () => {
      const r = renderer();

      expect(r.render(input(), undefined, "zzz-nowhere")).toContain(
        'Nothing matches "zzz-nowhere".',
      );
      expect(r.render(input(), "actions", "zzz-nowhere")).toContain(
        'Nothing in `actions` matches "zzz-nowhere".',
      );
    });
  });

  describe("schema types", () => {
    it("spells out nesting to a depth, then abbreviates", () => {
      const deep = {
        type: "object",
        properties: {
          a: {
            type: "object",
            properties: {
              b: {
                type: "object",
                properties: {
                  c: { type: "object", properties: { d: { type: "string" } } },
                },
              },
            },
          },
        },
      };

      expect(renderer().type(deep)).toBe("{ a?: { b?: { c?: { ... } } } }");
    });

    it("writes unions, nullables and records", () => {
      const r = renderer();

      expect(r.type({ type: ["string", "null"] })).toBe("string | null");
      expect(
        r.type({
          type: "array",
          items: { anyOf: [{ type: "string" }, { type: "number" }] },
        }),
      ).toBe("(string | number)[]");
      expect(
        r.type({ type: "object", additionalProperties: { type: "boolean" } }),
      ).toBe("Record<string, boolean>");
    });
  });

  describe("alepha docs --app", () => {
    it("refuses an unknown section before loading the app", async () => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } });
      const cli = alepha.inject(CliProvider);
      const cmd = alepha.inject(DocsCommand);

      await expect(
        cli.run(cmd.docs, { root: "/project", argv: "--app nope" }),
      ).rejects.toThrow('Unknown app section "nope"');
    });
  });
});
